import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const CHROME_PATH = process.env.CHROME_PATH || '';
const DEFAULT_CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ARTIFACT_DIR =
  process.env.ARTIFACT_DIR ?? path.resolve(__dirname, '../screenshots/test-scenarios');

const apiUrl = (pathname) => new URL(pathname, BASE_URL).toString();
const ADMIN_IDENTIFIER = 'admin';
const ADMIN_PASSWORD = process.env.AUTH_ADMIN_PASSWORD;
const CURATOR_IDENTIFIER = 'curator_1';
const WRITER_IDENTIFIER = 'writer_1';
const DEFAULT_PASSWORD = process.env.SMOKE_TEST_PASSWORD;
if (!ADMIN_PASSWORD || !DEFAULT_PASSWORD) {
  throw new Error('Set AUTH_ADMIN_PASSWORD and SMOKE_TEST_PASSWORD for disposable test accounts.');
}
const ROOM_GLB_FILES = [
  path.resolve(__dirname, 'public/models/room1.glb'),
  path.resolve(__dirname, 'public/models/room2.glb'),
  path.resolve(__dirname, 'public/models/room3.glb'),
  path.resolve(__dirname, 'public/models/center.glb'),
];
const VIEWER_NAVIGATION_TARGETS = [
  { key: 'center', code: 'Digit1', label: 'Center', x: 13.3, z: 19.4 },
  { key: 'room1', code: 'Digit2', label: 'Room 1', x: 8.2, z: 9.5 },
  { key: 'room2', code: 'Digit3', label: 'Room 2', x: 8.5, z: 6.9 },
  { key: 'room3', code: 'Digit4', label: 'Room 3', x: 9.3, z: -5.1 },
];
const CURATOR_SPACE_COPY = {
  displayName: /^(Display name|표시 이름)$/i,
  selectedName: /^(Selected space name|선택된 공간 이름)$/i,
};
const ROOM_MERGE_COPY = {
  spaceEditor: /^Space editor$/,
  spaceEditorWindow: /^Space editor window$/,
  spaceLabel: /^Space$/,
  layoutName: /^Layout name$/,
  layoutDescription: /^Layout description$/,
  saveLayout: /^Save layout$/,
};
const SMOKE_ARTWORK_IMAGE_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3mFJ0AAAAASUVORK5CYII=',
  'base64',
);

const resolveExecutablePath = () => {
  if (CHROME_PATH && existsSync(CHROME_PATH)) {
    return CHROME_PATH;
  }

  if (existsSync(DEFAULT_CHROME_PATH)) {
    return DEFAULT_CHROME_PATH;
  }

  return undefined;
};

const buildScenarioResult = (name) => ({
  name,
  status: 'pending',
  notes: [],
  errors: [],
  screenshot: null,
});

const validateLayout = (layout, label) => {
  if (!layout || !Array.isArray(layout.placements) || layout.placements.length === 0) {
    throw new Error(`${label} layout did not include any placements`);
  }

  const firstPlacement = layout.placements[0];
  const artwork = firstPlacement?.artwork;
  if (!artwork || !artwork.id || !artwork.title) {
    throw new Error(`${label} layout first placement is missing artwork metadata`);
  }

  if (!artwork.imagePath) {
    throw new Error(`${label} layout first artwork is missing imagePath metadata`);
  }

  return {
    placementCount: layout.placements.length,
    firstArtwork: {
      id: artwork.id,
      title: artwork.title,
      imagePath: artwork.imagePath,
    },
  };
};

const pickNearestViewerTarget = (placement) => {
  let nearestTarget = VIEWER_NAVIGATION_TARGETS[0];
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const target of VIEWER_NAVIGATION_TARGETS) {
    const distance = Math.hypot(
      placement.position.x - target.x,
      placement.position.z - target.z,
    );
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestTarget = target;
    }
  }

  return {
    target: nearestTarget,
    distance: nearestDistance,
  };
};

const pickBestViewerPlacement = (placements) => {
  let best = null;

  for (const placement of placements) {
    const artworkId = Number(placement?.artwork?.id);
    if (!Number.isFinite(artworkId)) continue;

    const nearest = pickNearestViewerTarget(placement);
    if (!best || nearest.distance < best.distance) {
      best = {
        placement,
        target: nearest.target,
        distance: nearest.distance,
      };
    }
  }

  return best;
};

const createRecorder = () => {
  const events = [];

  const isIgnorableRequestFailure = (event) => {
    if (event.type !== 'requestfailed') return false;
    if (event.error !== 'net::ERR_ABORTED') return false;
    return event.url.includes('/assets/tts/') || event.url.includes('fonts.gstatic.com/');
  };

  return {
    attach(page, scenario) {
      page.on('console', (msg) => {
        events.push({
          scenario,
          type: 'console',
          level: msg.type(),
          text: msg.text(),
        });
      });

      page.on('pageerror', (err) => {
        events.push({
          scenario,
          type: 'pageerror',
          text: err.stack || err.message,
        });
      });

      page.on('requestfailed', (req) => {
        events.push({
          scenario,
          type: 'requestfailed',
          url: req.url(),
          error: req.failure()?.errorText ?? 'unknown',
        });
      });

      page.on('response', (res) => {
        const url = res.url();
        if (!url.includes('/api/')) return;

        events.push({
          scenario,
          type: 'response',
          url,
          status: res.status(),
        });
      });
    },

    relevantErrors(scenario) {
      return events.filter((event) => {
        if (event.scenario !== scenario) return false;
        if (event.type === 'pageerror') return true;
        if (event.type === 'requestfailed') return !isIgnorableRequestFailure(event);
        if (event.type === 'response' && event.status >= 400) return true;
        if (event.type === 'console' && event.level === 'error') return true;
        return false;
      });
    },
  };
};

const fetchJson = async (url, init) => {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to fetch ${url}: ${response.status} ${body}`.trim());
  }

  return response.json();
};

const loadCurationOptions = async () => {
  const payload = await fetchJson(apiUrl('/api/v1/curation/options'));
  if (!payload || !Array.isArray(payload.axes)) {
    throw new Error('Curation options response did not include axes');
  }

  return payload;
};

const pickAxisOptions = (axes) => {
  const requiredCategories = ['theme', 'era', 'emotion'];
  return requiredCategories.map((category) => {
    const axis = axes.find((item) => item.category === category);
    if (!axis) {
      throw new Error(`Missing axis: ${category}`);
    }

    if (!Array.isArray(axis.options) || axis.options.length === 0) {
      throw new Error(`Axis ${category} does not contain selectable options`);
    }

    const option = [...axis.options].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0];
    const selectorKey = option.optionKey ?? String(option.id);

    return {
      category,
      axis,
      option,
      testId: `option-${selectorKey}`,
    };
  });
};

const openHomePage = async (page) => {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByTestId('home-start-exhibition').waitFor({
    state: 'visible',
    timeout: 15000,
  });
};

const waitForViewerReady = async (page) => {
  await page.waitForFunction(() => window.location.hash.includes('/spaces/'));
  const pendingLoader = page.getByTestId('app-library-viewer-pending');
  const routeLoader = page.getByTestId('app-library-viewer-loading');

  if (await pendingLoader.count()) {
    await pendingLoader.waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
  }
  if (await routeLoader.count()) {
    await routeLoader.waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
  }

  await page.locator('#viewer-canvas').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1200);
};

const loginAsAdmin = async () => {
  return fetchJson(apiUrl('/api/v1/auth/login'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      identifier: ADMIN_IDENTIFIER,
      password: ADMIN_PASSWORD,
    }),
  });
};

const loginAsCurator = async () => {
  return fetchJson(apiUrl('/api/v1/auth/login'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      identifier: CURATOR_IDENTIFIER,
      password: DEFAULT_PASSWORD,
    }),
  });
};

const loginAsWriter = async () => {
  return fetchJson(apiUrl('/api/v1/auth/login'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      identifier: WRITER_IDENTIFIER,
      password: DEFAULT_PASSWORD,
    }),
  });
};

const authenticatedFetch = async (session, pathname, init = {}) => {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${session.accessToken}`);
  return fetch(apiUrl(pathname), {
    ...init,
    headers,
  });
};

const authenticatedFetchJson = async (session, pathname, init = {}) => {
  const response = await authenticatedFetch(session, pathname, init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to fetch ${pathname}: ${response.status} ${body}`.trim());
  }

  return response.json();
};

const getTestDbPath = () => {
  const dbPath = process.env.TEST_DB_PATH;
  if (!dbPath) {
    throw new Error('TEST_DB_PATH is not set. Use the test-db smoke runner.');
  }
  return dbPath;
};

const escapeSqlLiteral = (value) => String(value).replace(/'/g, "''");

const runSqliteUpdate = (sql) => {
  const dbPath = getTestDbPath();
  const result = spawnSync('/usr/bin/sqlite3', [dbPath, sql], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Failed to execute sqlite update.');
  }
};

const createAuthenticatedPage = async (
  browser,
  recorder,
  scenarioName,
  viewport = { width: 1600, height: 1200 },
  session = null,
) => {
  const activeSession = session ?? await loginAsAdmin();
  const context = await browser.newContext({
    viewport,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await context.addInitScript(
    ({ accessToken, refreshToken }) => {
      localStorage.setItem('digital_twin_access_token', accessToken);
      localStorage.setItem('digital_twin_refresh_token', refreshToken);
    },
    {
      accessToken: activeSession.accessToken,
      refreshToken: activeSession.refreshToken,
    },
  );
  const page = await context.newPage();
  recorder.attach(page, scenarioName);
  return { context, page, session: activeSession };
};

const uploadCuratorSpaceGlb = async (session, spaceId, filePath) => {
  const fileBytes = await fs.readFile(filePath);
  const formData = new FormData();
  formData.append('file', new Blob([fileBytes]), path.basename(filePath));

  const response = await fetch(apiUrl(`/api/v1/curator/spaces/${spaceId}/files`), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to upload ${path.basename(filePath)}: ${response.status} ${body}`.trim());
  }

  return response.json();
};

const buildSmokeRoomMergeSnapshot = () => ({
  selectedKey: 'room2',
  pieces: {
    room1: {
      position: [5.25, 0.1, 12.8],
      rotation: [0, 1.18, 0],
    },
    room2: {
      position: [5.75, 0.05, 3.6],
      rotation: [0, 3.14, 0],
    },
    room3: {
      position: [4.7, 0, -7.05],
      rotation: [0, -1.2, 0],
    },
    center: {
      position: [13.85, 0, 6.65],
      rotation: [0, 0.2, 0],
    },
  },
});

const createSmokeCuratorSpace = async (session, spaceName, filePaths) => {
  const createResponse = await authenticatedFetchJson(session, '/api/v1/curator/spaces', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: spaceName,
      description: 'Owned asset smoke space for curator profile testing.',
    }),
  });

  const spaceId = createResponse.id;
  const uploadedFiles = [];
  for (const filePath of filePaths) {
    uploadedFiles.push(await uploadCuratorSpaceGlb(session, spaceId, filePath));
  }

  const components = uploadedFiles.map((file, index) => ({
    componentKey: `component-${index + 1}`,
    label: `Component ${index + 1}`,
    spaceFileId: file.id,
    position: {
      x: index * 1.25,
      y: 0,
      z: index * -0.75,
    },
    rotation: {
      x: 0,
      y: index * 0.2,
      z: 0,
    },
    scale: {
      x: 1,
      y: 1,
      z: 1,
    },
    sortOrder: index,
  }));

  await authenticatedFetchJson(session, `/api/v1/curator/spaces/${spaceId}/components`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      components,
    }),
  });

  const published = await authenticatedFetchJson(session, `/api/v1/curator/spaces/${spaceId}/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      versionName: 'Smoke profile publish',
      displayName: spaceName,
      summary: 'Profile smoke publish.',
      locationSummary: 'Smoke Gallery / Profile',
      searchKeywords: ['smoke', 'profile', 'owned'],
      isFeatured: true,
      isDefault: false,
      displayOrder: 1000,
    }),
  });

  return {
    ...published,
    id: spaceId,
  };
};

const runCuratorProfileOwnedAssetsScenario = async (browser, recorder) => {
  const result = buildScenarioResult('curator-profile-owned-assets');
  const session = await loginAsAdmin();
  const { page, context } = await createAuthenticatedPage(
    browser,
    recorder,
    result.name,
    { width: 1700, height: 1600 },
    session,
  );

  try {
    const artworkList = await fetchJson(apiUrl('/api/v1/artworks?limit=1'));
    const artworkCandidate = artworkList?.data?.[0];
    if (!artworkCandidate?.id) {
      throw new Error('Could not find a seed artwork for curator profile smoke.');
    }
    const artworkId = artworkCandidate.id;
    runSqliteUpdate(
      [
        `UPDATE artworks`,
        `SET owner_user_id = ${session.user.id}`,
        `WHERE id = ${artworkId};`,
      ].join(' '),
    );

    const storytelling = await authenticatedFetchJson(session, '/api/v1/storytelling/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        artworkIds: [artworkId],
        batchName: 'Smoke profile batch',
        globalNote: 'Profile smoke generation.',
        perArtworkNotes: {
          [artworkId]: 'Use a calm exhibition narration for the curator profile page.',
        },
      }),
    });
    const version = storytelling.items?.[0]?.version;
    if (!version?.id || version.status !== 'published') {
      throw new Error('Profile smoke storytelling version was not published.');
    }

    const ttsResponse = await authenticatedFetchJson(session, `/api/v1/storytelling/versions/${version.id}/tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        forceRebuild: true,
      }),
    });
    if (ttsResponse.status !== 'success' || !ttsResponse.ttsAsset?.audioUrl) {
      throw new Error('Profile smoke TTS generation failed.');
    }

    const spaceName = `Smoke Profile Space ${Date.now()}`;
    const space = await createSmokeCuratorSpace(session, spaceName, ROOM_GLB_FILES);

    await page.goto(apiUrl(`/#/debug/glb-room-merge-experiment?spaceId=${space.id}`), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.getByRole('button', { name: ROOM_MERGE_COPY.spaceEditor }).waitFor({
      state: 'visible',
      timeout: 15000,
    });
    await page.getByText(spaceName, { exact: false }).first().waitFor({
      state: 'visible',
      timeout: 15000,
    });

    const smokeSnapshot = buildSmokeRoomMergeSnapshot();
    const snapshotResponse = await authenticatedFetchJson(session, '/api/v1/debug/room-merge/snapshots', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        experimentKey: 'glb-room-merge-experiment',
        spaceId: space.id,
        sessionId: session.accessToken.slice(0, 16),
        memo: 'Profile smoke snapshot.',
        snapshot: smokeSnapshot,
      }),
    });
    const presetResponse = await authenticatedFetchJson(session, '/api/v1/debug/room-merge/presets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        experimentKey: 'glb-room-merge-experiment',
        spaceId: space.id,
        sessionId: session.accessToken.slice(0, 16),
        presetName: `Profile smoke preset ${Date.now()}`,
        memo: 'Profile smoke preset.',
        selectedKey: smokeSnapshot.selectedKey,
        snapshot: smokeSnapshot,
      }),
    });

    const profile = await authenticatedFetchJson(session, '/api/v1/workspace/curator');
    const writerSession = await loginAsWriter();
    const writerProfile = await authenticatedFetchJson(writerSession, '/api/v1/workspace/writer');
    const curatorSession = await loginAsCurator();
    const curatorProfile = await authenticatedFetchJson(curatorSession, '/api/v1/workspace/curator');
    const writerCuratorResponse = await authenticatedFetch(writerSession, '/api/v1/workspace/curator');
    const curatorWriterResponse = await authenticatedFetch(curatorSession, '/api/v1/workspace/writer');
    const ownedSpace = profile.ownedSpaces.find((item) => item.id === space.id);
    const ownedArtwork = profile.ownedArtworks.find((item) => item.id === artworkId);
    const linkedSnapshot = profile.roomMergeSnapshots.find((item) => item.spaceId === space.id);
    const linkedPreset = profile.roomMergePresets.find((item) => item.spaceId === space.id);

    if (!ownedSpace) {
      throw new Error('Curator profile did not include the owned space.');
    }
    if (!ownedArtwork) {
      throw new Error('Curator profile did not include the owned artwork.');
    }
    if (!ownedArtwork.currentStory || ownedArtwork.ttsAssets.length === 0) {
      throw new Error('Curator profile did not include story and TTS for the owned artwork.');
    }
    if (!linkedSnapshot || !linkedPreset) {
      throw new Error('Curator profile did not include linked room merge snapshot/preset.');
    }
    if (writerProfile.user.primaryRole !== 'writer') {
      throw new Error('Writer workspace route did not return a writer profile.');
    }
    if (curatorProfile.user.primaryRole === 'writer') {
      throw new Error('Curator workspace route returned a writer profile.');
    }
    if (writerCuratorResponse.status !== 403) {
      throw new Error(`Writer workspace user unexpectedly accessed curator route: ${writerCuratorResponse.status}`);
    }
    if (curatorWriterResponse.status !== 403) {
      throw new Error(`Curator workspace user unexpectedly accessed writer route: ${curatorWriterResponse.status}`);
    }

    await page.goto(apiUrl('/#/debug/curator-workspace'), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.getByRole('heading', { name: /(Curator Workspace|큐레이터 작업공간)/ }).waitFor({
      state: 'visible',
      timeout: 15000,
    });
    const screenshotPath = path.join(ARTIFACT_DIR, 'curator-profile-owned-assets.png');
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });

    result.notes.push(`space=${space.id}:${spaceName}`);
    result.notes.push(`artwork=${artworkId}:${artworkCandidate.title ?? 'seed artwork'}`);
    result.notes.push(`version=${version.id}`);
    result.notes.push(`snapshot=${snapshotResponse.snapshot.id}`);
    result.notes.push(`preset=${presetResponse.id}`);
    result.screenshot = screenshotPath;
  } catch (error) {
    result.errors.push({
      type: 'exception',
      text: error instanceof Error ? error.stack || error.message : String(error),
    });
  } finally {
    const errors = recorder.relevantErrors(result.name);
    finalizeScenario(result, errors);
    await page.close();
    await context.close();
  }

  return result;
};

const runStorytellingTtsScenario = async () => {
  const result = buildScenarioResult('storytelling-tts');
  const session = await loginAsAdmin();

  try {
    const generated = await authenticatedFetchJson(
      session,
      '/api/v1/storytelling/generate',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          artworkIds: [1],
          batchName: 'Smoke TTS',
          globalNote: 'Smoke test storytelling for TTS generation.',
          perArtworkNotes: {
            1: 'Keep the tone calm and suitable for an exhibition narration.',
          },
        }),
      },
    );
    const generatedVersion = generated.items?.[0]?.version;
    if (!generatedVersion?.id || generatedVersion.status !== 'published') {
      throw new Error('Failed to generate a published storytelling version for TTS smoke.');
    }
    const versionId = generatedVersion.id;

    const failureResponse = await authenticatedFetchJson(
      session,
      `/api/v1/storytelling/versions/${versionId}/tts`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          voiceId: 'Invalid_Test_Voice',
          forceRebuild: true,
        }),
      },
    );

    if (failureResponse.status !== 'failed') {
      throw new Error(`Expected failed TTS response, got ${failureResponse.status}.`);
    }
    if (!failureResponse.ttsAsset?.errorMessage) {
      throw new Error('Failed TTS response did not include an error message.');
    }

    const successResponse = await authenticatedFetchJson(
      session,
      `/api/v1/storytelling/versions/${versionId}/tts`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          forceRebuild: true,
        }),
      },
    );

    if (successResponse.status !== 'success') {
      throw new Error(`Expected successful TTS response, got ${successResponse.status}.`);
    }
    if (!successResponse.ttsAsset?.audioUrl) {
      throw new Error('Successful TTS response did not include an audioUrl.');
    }

    const audioResponse = await fetch(apiUrl(successResponse.ttsAsset.audioUrl));
    if (!audioResponse.ok) {
      throw new Error(`Generated audio URL was not reachable: ${audioResponse.status}`);
    }

    result.notes.push(`version=${versionId}`);
    result.notes.push(`failure=${failureResponse.ttsAsset.status}:${failureResponse.ttsAsset.errorMessage}`);
    result.notes.push(`success=${successResponse.ttsAsset.status}:${successResponse.ttsAsset.audioUrl}`);
  } catch (error) {
    result.errors.push({
      type: 'exception',
      text: error instanceof Error ? error.stack || error.message : String(error),
    });
  }

  finalizeScenario(result, []);
  return result;
};

const saveScreenshot = async (page, fileName) => {
  const target = path.join(ARTIFACT_DIR, fileName);
  await page.screenshot({ path: target, fullPage: true });
  return target;
};

const closeBrowser = async (browser) => {
  const process = typeof browser.process === 'function' ? browser.process() : null;
  const timeoutMs = 5000;

  try {
    await Promise.race([
      browser.close(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out closing browser after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  } catch (error) {
    if (process) {
      process.kill('SIGKILL');
    }
  }
};

const finalizeScenario = (result, errors, extraNote) => {
  if (extraNote) {
    result.notes.push(extraNote);
  }

  if (errors.length > 0) {
    result.errors.push(...errors);
  }

  result.status = result.errors.length > 0 ? 'failed' : 'passed';
};

const runHomeScenario = async (browser, recorder) => {
  const result = buildScenarioResult('home');
  const { page, context } = await createAuthenticatedPage(
    browser,
    recorder,
    result.name,
    { width: 1440, height: 1200 },
  );

  try {
    const spaces = await fetchJson(apiUrl('/api/v1/spaces/published?sort=featured&limit=24&offset=0'));
    const defaultSpace = spaces.items.find((space) => space.isDefault) ?? spaces.items[0];
    if (!defaultSpace) {
      throw new Error('No published spaces returned from API.');
    }

    await openHomePage(page);
    await page.getByTestId('home-start-exhibition').click();
    await page.waitForFunction(() => window.location.hash.startsWith('#/library/'));
    await page.getByTestId('public-space-search').waitFor({
      state: 'attached',
      timeout: 15000,
    });
    await page.locator('[data-testid^="public-space-card-"]').first().waitFor({
      state: 'visible',
      timeout: 15000,
    });
    await page.getByTestId(`public-space-card-${defaultSpace.id}`).click();
    const enterButton = page.locator('button:has-text("입장하기"):not([disabled])').first();
    await enterButton.waitFor({ state: 'visible', timeout: 15000 });
    await enterButton.click();
    await page.getByTestId('public-space-default-viewing').waitFor({ state: 'visible', timeout: 15000 });
    await page.getByTestId('public-space-default-viewing').click();
    await waitForViewerReady(page);
    result.notes.push(`defaultSpace=${defaultSpace.id}:${defaultSpace.title}`);
    result.screenshot = await saveScreenshot(page, 'public-space-viewer.png');
  } catch (error) {
    result.errors.push({
      type: 'exception',
      text: error instanceof Error ? error.stack || error.message : String(error),
    });
  } finally {
    const errors = recorder.relevantErrors(result.name);
    finalizeScenario(result, errors, `baseUrl=${BASE_URL}`);
    await page.close();
    await context.close();
  }

  return result;
};

const runProtectedRouteRedirectScenario = async (browser, recorder) => {
  const result = buildScenarioResult('protected-route-redirect');
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  recorder.attach(page, result.name);

  try {
    await page.goto(apiUrl('/#/debug/curator-workspace'), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForFunction(() => window.location.hash === '#/');
    await page.getByTestId('home-start-exhibition').waitFor({
      state: 'visible',
      timeout: 15000,
    });
    await page.getByTestId('auth-overlay-panel').waitFor({
      state: 'visible',
      timeout: 15000,
    });
    await page.getByTestId('auth-login-prompt').waitFor({
      state: 'visible',
      timeout: 15000,
    });
    result.notes.push('redirected-to-home-with-login-prompt');
    result.screenshot = await saveScreenshot(page, 'protected-route-redirect.png');
  } catch (error) {
    result.errors.push({
      type: 'exception',
      text: error instanceof Error ? error.stack || error.message : String(error),
    });
  } finally {
    const errors = recorder.relevantErrors(result.name);
    finalizeScenario(result, errors);
    await page.close();
  }

  return result;
};

const runViewerStoryTtsButtonScenario = async (browser, recorder) => {
  const result = buildScenarioResult('viewer-story-tts-button');
  try {
    const spaces = await fetchJson(apiUrl('/api/v1/spaces/published?sort=featured&limit=24&offset=0'));
    const defaultSpace = spaces.items.find((space) => space.isDefault) ?? spaces.items[0];
    if (!defaultSpace) {
      throw new Error('No published spaces returned from API.');
    }

    const detail = await fetchJson(apiUrl(`/api/v1/spaces/published/${defaultSpace.id}`));
    const placementChoice = pickBestViewerPlacement(detail?.viewerLayout?.placements ?? []);
    if (!placementChoice) {
      throw new Error('Published space detail did not include a valid artwork placement.');
    }

    const placement = placementChoice.placement;
    const artworkId = Number(placement.artwork.id);
    const { target, distance } = placementChoice;
    const adminSession = await loginAsAdmin();
    const { page, context } = await createAuthenticatedPage(
      browser,
      recorder,
      result.name,
      { width: 1440, height: 1200 },
      adminSession,
    );

    const currentResponse = await authenticatedFetchJson(adminSession, `/api/v1/storytelling/artworks/${artworkId}/current`);
    let currentVersion = currentResponse.currentVersion ?? null;
    let currentTtsAssets = currentResponse.ttsAssets ?? [];

    if (!currentVersion || currentVersion.status !== 'published') {
      const storytelling = await authenticatedFetchJson(
        adminSession,
        '/api/v1/storytelling/generate',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            artworkIds: [artworkId],
            batchName: 'Viewer Story TTS Smoke',
            globalNote: 'Prepare a published story for the viewer TTS button smoke.',
            perArtworkNotes: {
              [artworkId]: 'Keep the narration calm and suitable for exhibition playback.',
            },
          }),
        },
      );

      currentVersion = storytelling.items?.[0]?.version ?? null;
      if (!currentVersion || currentVersion.status !== 'published') {
        throw new Error('Failed to prepare a published storytelling version for the viewer smoke.');
      }

      const refreshed = await authenticatedFetchJson(adminSession, `/api/v1/storytelling/artworks/${artworkId}/current`);
      currentVersion = refreshed.currentVersion ?? null;
      currentTtsAssets = refreshed.ttsAssets ?? [];
    }

    const readyTtsAsset = currentTtsAssets.find((asset) => asset.status === 'ready' && asset.audioUrl);
    if (!readyTtsAsset) {
      const versionId = currentVersion?.id;
      if (!versionId) {
        throw new Error('Viewer smoke could not resolve a published storytelling version.');
      }

      const ttsResponse = await authenticatedFetchJson(
        adminSession,
        `/api/v1/storytelling/versions/${versionId}/tts`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            forceRebuild: true,
          }),
        },
      );

      if (ttsResponse.status !== 'success' || !ttsResponse.ttsAsset?.audioUrl) {
        throw new Error('Viewer smoke did not produce a ready TTS audioUrl.');
      }

      const refreshed = await authenticatedFetchJson(adminSession, `/api/v1/storytelling/artworks/${artworkId}/current`);
      currentVersion = refreshed.currentVersion ?? currentVersion;
      currentTtsAssets = refreshed.ttsAssets ?? [];
    }

    if (!currentVersion?.id) {
      throw new Error('Viewer smoke could not keep a published storytelling version after TTS generation.');
    }

    await page.goto(apiUrl(`/#/library/public-space/spaces/${defaultSpace.id}`), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await waitForViewerReady(page);
    await page.keyboard.press(target.code);
    await page.getByTestId('viewer-artwork-prompt').waitFor({
      state: 'visible',
      timeout: 15000,
    });
    await page.keyboard.press('Enter');

    const storyButton = page.getByRole('button', { name: '직접 듣는 스토리' });
    await storyButton.waitFor({ state: 'visible', timeout: 15000 });
    await storyButton.click();

    await page.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return Boolean(audio && audio.currentSrc && audio.currentSrc.length > 0);
    });
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return Boolean(audio && !audio.paused);
    });
    await page.keyboard.press('Escape');
    await storyButton.waitFor({ state: 'detached', timeout: 15000 });

    result.notes.push(`space=${defaultSpace.id}:${defaultSpace.title}`);
    result.notes.push(`artwork=${artworkId}:${placement.artwork.title ?? 'unknown'}`);
    result.notes.push(`target=${target.key}:${target.label}:distance=${distance.toFixed(2)}`);
    result.notes.push(`version=${currentVersion.id}`);
    result.notes.push(`tts=${readyTtsAsset?.audioUrl ?? 'generated'}`);
    result.screenshot = await saveScreenshot(page, 'viewer-story-tts-button.png');
    await page.close();
    await context.close();
  } catch (error) {
    result.errors.push({
      type: 'exception',
      text: error instanceof Error ? error.stack || error.message : String(error),
    });
  } finally {
    const errors = recorder.relevantErrors(result.name);
    finalizeScenario(result, errors);
  }

  return result;
};

const runPublishedSpaceApiScenario = async () => {
  const result = buildScenarioResult('published-spaces-api');

  try {
    const list = await fetchJson(apiUrl('/api/v1/spaces/published?sort=featured&limit=2&offset=0'));
    if (!list || !Array.isArray(list.items) || list.items.length === 0) {
      throw new Error('Published spaces list is empty.');
    }

    const defaultSpace = list.items.find((space) => space.isDefault) ?? list.items[0];
    const secondPage = await fetchJson(apiUrl('/api/v1/spaces/published?sort=featured&limit=2&offset=2'));
    const detail = await fetchJson(apiUrl(`/api/v1/spaces/published/${defaultSpace.id}`));
    const defaultDetail = await fetchJson(apiUrl('/api/v1/spaces/published/default'));
    const featuredList = await fetchJson(apiUrl('/api/v1/spaces/published?featuredOnly=true&sort=featured&limit=24&offset=0'));
    const defaultList = await fetchJson(apiUrl('/api/v1/spaces/published?defaultOnly=true&sort=featured&limit=24&offset=0'));
    const titleSorted = await fetchJson(apiUrl('/api/v1/spaces/published?sort=title&limit=24&offset=0'));
    const curatorSorted = await fetchJson(apiUrl('/api/v1/spaces/published?sort=curator&limit=24&offset=0'));
    const test1Space = list.items.find((space) => space.title === 'test1') ?? null;
    const test1Detail = test1Space
      ? await fetchJson(apiUrl(`/api/v1/spaces/published/${test1Space.id}`))
      : null;

    if (!detail.viewerLayout || !Array.isArray(detail.viewerLayout.placements) || detail.viewerLayout.placements.length === 0) {
      throw new Error('Published space detail did not include viewer layout placements.');
    }

    if (!defaultDetail.isDefault) {
      throw new Error('Default published space endpoint did not return the default space.');
    }

    if (list.page !== 1 || list.pageSize !== 2) {
      throw new Error(`Page 1 metadata mismatch: page=${list.page}, pageSize=${list.pageSize}`);
    }

    if (secondPage.page !== 2 || secondPage.pageSize !== 2) {
      throw new Error(`Page 2 metadata mismatch: page=${secondPage.page}, pageSize=${secondPage.pageSize}`);
    }

    if (!featuredList.items.every((space) => space.isFeatured)) {
      throw new Error('Featured-only filter returned a non-featured space.');
    }

    if (!defaultList.items.every((space) => space.isDefault)) {
      throw new Error('Default-only filter returned a non-default space.');
    }

    if (titleSorted.items.length > 1) {
      const titles = titleSorted.items.map((space) => space.title);
      const sortedTitles = [...titles].sort((left, right) => left.localeCompare(right));
      if (titles.join('|') !== sortedTitles.join('|')) {
        throw new Error('Title sort order is incorrect.');
      }
    }

    if (curatorSorted.items.length > 1) {
      const curators = curatorSorted.items.map((space) => space.curatorDisplayName);
      const sortedCurators = [...curators].sort((left, right) => left.localeCompare(right));
      if (curators.join('|') !== sortedCurators.join('|')) {
        throw new Error('Curator sort order is incorrect.');
      }
    }

    if (!test1Space || !test1Detail || !Array.isArray(test1Detail.viewerLayout?.placements)) {
      throw new Error('Published space test1 layout could not be loaded.');
    }

    const test1Placements = test1Detail.viewerLayout.placements;
    const expectedPieceCount = Number(test1Detail.pieceCount ?? test1Placements.length);
    if (test1Placements.length !== expectedPieceCount) {
      throw new Error(`test1 should expose ${expectedPieceCount} placements, got ${test1Placements.length}.`);
    }

    for (let index = 0; index < test1Placements.length; index += 1) {
      const placement = test1Placements[index];
      const expectedSlotNumber = index + 1;
      if (placement.slotNumber !== expectedSlotNumber) {
        throw new Error(`test1 placement order mismatch at index ${index}: expected slot ${expectedSlotNumber}, got ${placement.slotNumber}.`);
      }

      if (!Number.isFinite(Number(placement.position?.rotationY))) {
        throw new Error(`test1 placement ${index + 1} is missing a valid rotationY value.`);
      }
    }

    const searchList = await fetchJson(apiUrl('/api/v1/spaces/published?query=night&sort=title&limit=10&offset=0'));
    result.notes.push(`total=${list.total}`);
    result.notes.push(`default=${defaultSpace.id}:${defaultSpace.title}`);
    result.notes.push(`page2=${secondPage.page}:${secondPage.count}`);
    result.notes.push(`featuredCount=${featuredList.count}`);
    result.notes.push(`defaultCount=${defaultList.count}`);
    result.notes.push(`nightMatches=${searchList.count}`);
    result.notes.push(`detailPieces=${detail.pieceCount}`);
    result.notes.push(`test1=${test1Space.id}:${test1Placements.length}`);
  } catch (error) {
    result.errors.push({
      type: 'exception',
      text: error instanceof Error ? error.stack || error.message : String(error),
    });
  }

  finalizeScenario(result, []);

  return result;
};

const runPublishedSpaceLibraryScenario = async (browser, recorder) => {
  const result = buildScenarioResult('public-space-library');
  const { page, context } = await createAuthenticatedPage(
    browser,
    recorder,
    result.name,
    { width: 1440, height: 1200 },
  );

  try {
    await page.goto(apiUrl('/#/library'), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.getByTestId('public-space-search').waitFor({
      state: 'attached',
      timeout: 15000,
    });
    await page.getByTestId('public-space-page-size').selectOption('2');
    await page.waitForFunction(() => {
      const indicator = document.querySelector('[data-testid="public-space-page-indicator"]');
      return Boolean(indicator?.textContent?.includes('Page 1 /'));
    });

    const firstPageCardId = await page.locator('[data-testid^="public-space-card-"]').first().getAttribute('data-testid');
    await page.getByTestId('public-space-next-page').click();
    await page.waitForFunction(() => {
      const indicator = document.querySelector('[data-testid="public-space-page-indicator"]');
      return Boolean(indicator?.textContent?.includes('Page 2 /'));
    });
    await page.waitForFunction((previousCardId) => {
      const cards = Array.from(document.querySelectorAll('[data-testid^="public-space-card-"]')).map((element) =>
        element.getAttribute('data-testid'),
      );
      return cards.length === 2 && cards[0] !== previousCardId;
    }, firstPageCardId);

    const secondPageCardId = await page.locator('[data-testid^="public-space-card-"]').first().getAttribute('data-testid');
    if (!firstPageCardId || !secondPageCardId || firstPageCardId === secondPageCardId) {
      throw new Error('Pagination did not advance to a different page of results.');
    }

    await page.getByTestId('public-space-filter-featured').click();
    await page.waitForFunction(() => {
      const indicator = document.querySelector('[data-testid="public-space-page-indicator"]');
      return Boolean(indicator?.textContent?.includes('Page 1 /'));
    });

    await page.getByTestId('public-space-sort-title').click();
    await page.waitForFunction(() => {
      const indicator = document.querySelector('[data-testid="public-space-page-indicator"]');
      return Boolean(indicator?.textContent?.includes('Page 1 /'));
    });

    result.notes.push(`page1=${firstPageCardId}`);
    result.notes.push(`page2=${secondPageCardId}`);
    result.screenshot = await saveScreenshot(page, 'public-space-library-pagination.png');
  } catch (error) {
    result.errors.push({
      type: 'exception',
      text: error instanceof Error ? error.stack || error.message : String(error),
    });
  } finally {
    const errors = recorder.relevantErrors(result.name);
    finalizeScenario(result, errors);
    await page.close();
    await context.close();
  }

  return result;
};

const runCuratorGlbUploadScenario = async (browser, recorder) => {
  const result = buildScenarioResult('curator-glb-upload');
  const session = await loginAsAdmin();
  const { page, context } = await createAuthenticatedPage(
    browser,
    recorder,
    result.name,
    { width: 1600, height: 1400 },
    session,
  );

  try {
    const spaceName = `Smoke GLB Space ${Date.now()}`;
    const space = await createSmokeCuratorSpace(session, spaceName, ROOM_GLB_FILES);

    await page.goto(apiUrl(`/#/debug/curator-space-management?spaceId=${space.id}`), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.getByPlaceholder(CURATOR_SPACE_COPY.selectedName).waitFor({
      state: 'visible',
      timeout: 15000,
    });
    await page.getByPlaceholder(CURATOR_SPACE_COPY.selectedName).waitFor({
      state: 'visible',
      timeout: 15000,
    });
    await page.getByPlaceholder(CURATOR_SPACE_COPY.displayName).waitFor({
      state: 'visible',
      timeout: 15000,
    });
    await page.getByPlaceholder(CURATOR_SPACE_COPY.selectedName).fill(spaceName);
    await page.waitForFunction((expectedName) => {
      const input = document.querySelector('input[placeholder="선택된 공간 이름"], input[placeholder="Selected space name"]');
      return input instanceof HTMLInputElement && input.value === expectedName;
    }, spaceName, {
      timeout: 15000,
    });

    const publishedList = await fetchJson(
      apiUrl(`/api/v1/spaces/published?query=${encodeURIComponent(spaceName)}&sort=newest&limit=24&offset=0`),
    );
    if (!publishedList.items.some((item) => item.title === spaceName)) {
      throw new Error('Published space list did not include the newly published GLB space.');
    }

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'curator-glb-upload-published-space.png'),
      fullPage: true,
    });

    result.notes.push(`space=${spaceName}`);
    result.notes.push(
      `files=${ROOM_GLB_FILES.length}`,
    );
    result.notes.push(`published=${publishedList.items[0]?.title ?? 'missing'}`);
    result.screenshot = path.join(ARTIFACT_DIR, 'curator-glb-upload-published-space.png');
  } catch (error) {
    result.errors.push({
      type: 'exception',
      text: error instanceof Error ? error.stack || error.message : String(error),
    });
  } finally {
    const errors = recorder.relevantErrors(result.name);
    finalizeScenario(result, errors);
    await page.close();
    await context.close();
  }

  return result;
};

const runRoomMergeAssemblyScenario = async (browser, recorder) => {
  const result = buildScenarioResult('glb-room-merge-assembly');
  const { page, context } = await createAuthenticatedPage(browser, recorder, result.name, {
    width: 1600,
    height: 1200,
  });

  const selectRoomPiece = async (modelPath) => {
    await page.locator('button').filter({ hasText: modelPath }).first().click();
  };

  const setNumericInputs = async (values) => {
    const inputs = page.locator('input[type="number"]');
    await inputs.nth(0).fill(values.position[0]);
    await inputs.nth(1).fill(values.position[1]);
    await inputs.nth(2).fill(values.position[2]);
    await inputs.nth(3).fill(values.rotation[0]);
    await inputs.nth(4).fill(values.rotation[1]);
    await inputs.nth(5).fill(values.rotation[2]);
  };

  try {
    const spaceName = `Smoke Assembly Space ${Date.now()}`;
    const space = await createSmokeCuratorSpace(await loginAsAdmin(), spaceName, ROOM_GLB_FILES);

    await page.goto(apiUrl(`/#/debug/glb-room-merge-experiment?spaceId=${space.id}`), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.getByRole('button', { name: ROOM_MERGE_COPY.spaceEditor }).waitFor({
      state: 'visible',
      timeout: 15000,
    });

    const toggle = page.locator('button').filter({ hasText: ROOM_MERGE_COPY.spaceEditor }).first();
    await toggle.click();
    await page.getByRole('button', { name: 'Undo' }).waitFor({
      state: 'visible',
      timeout: 15000,
    });

    const transformInputs = page.locator('input[type="number"]');
    const originalRoom1X = await transformInputs.nth(0).inputValue();
    const changedRoom1X = (Number(originalRoom1X) + 0.25).toFixed(2);
    await selectRoomPiece('room1.glb');
    await transformInputs.nth(0).fill(changedRoom1X);
    await selectRoomPiece('room2.glb');
    await page.waitForFunction(() => {
      const undoButton = Array.from(document.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Undo',
      );
      return Boolean(undoButton && !undoButton.disabled);
    });
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.getByRole('button', { name: 'Copy positions' }).click();
    await page.waitForFunction(() => {
      const redoButton = Array.from(document.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Redo',
      );
      return Boolean(redoButton && !redoButton.disabled);
    });
    await page.getByRole('button', { name: 'Redo' }).click();
    await page.getByRole('button', { name: 'Copy positions' }).click();

    const manipulations = [
      {
        modelPath: 'room1.glb',
        position: ['5.25', '0.10', '12.80'],
        rotation: ['0.00', '1.18', '0.00'],
      },
      {
        modelPath: 'room2.glb',
        position: ['5.75', '0.05', '3.60'],
        rotation: ['0.00', '3.14', '0.00'],
      },
      {
        modelPath: 'room3.glb',
        position: ['4.70', '0.00', '-7.05'],
        rotation: ['0.00', '-1.20', '0.00'],
      },
      {
        modelPath: 'center.glb',
        position: ['13.85', '0.00', '6.65'],
        rotation: ['0.00', '0.20', '0.00'],
      },
    ];

    for (const manipulation of manipulations) {
      await selectRoomPiece(manipulation.modelPath);
      await setNumericInputs(manipulation);
    }

    await page.getByRole('button', { name: /^Save$/ }).click();
    await page.getByText('Saved snapshot', { exact: false }).waitFor({
      state: 'visible',
      timeout: 15000,
    });
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'glb-room-merge-assembly.png'),
      fullPage: true,
    });

    result.notes.push('room1, room2, room3, center adjusted');
    result.notes.push('snapshot saved');
    result.screenshot = path.join(ARTIFACT_DIR, 'glb-room-merge-assembly.png');
  } catch (error) {
    result.errors.push({
      type: 'exception',
      text: error instanceof Error ? error.stack || error.message : String(error),
    });
  } finally {
    const errors = recorder.relevantErrors(result.name);
    finalizeScenario(result, errors);
    await page.close();
    await context.close();
  }

  return result;
};

const runDefaultCurationScenario = async () => {
  const result = buildScenarioResult('default-curation');

  try {
    const layout = await fetchJson(apiUrl('/api/v1/curation/default'));
    const validation = validateLayout(layout, 'default');
    result.notes.push(`placementCount=${validation.placementCount}`);
    result.notes.push(`firstArtwork=${validation.firstArtwork.id}:${validation.firstArtwork.title}`);
  } catch (error) {
    result.errors.push({
      type: 'exception',
      text: error instanceof Error ? error.stack || error.message : String(error),
    });
  }

  finalizeScenario(result, []);

  return result;
};

const runSelectionScenario = async (axes) => {
  const result = buildScenarioResult('selection-curation');

  try {
    const selections = pickAxisOptions(axes);
    const payload = {
      themeOptionId: selections.find((selection) => selection.category === 'theme')?.option.id,
      eraOptionId: selections.find((selection) => selection.category === 'era')?.option.id,
      emotionOptionId: selections.find((selection) => selection.category === 'emotion')?.option.id,
      sessionId: randomUUID(),
    };

    if (
      payload.themeOptionId === undefined ||
      payload.eraOptionId === undefined ||
      payload.emotionOptionId === undefined
    ) {
      throw new Error('Could not build selection payload from backend options');
    }

    const layout = await fetchJson(apiUrl('/api/v1/curation/layouts'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const validation = validateLayout(layout, 'selection');
    const selectionPlacements = Array.isArray(layout.placements) ? layout.placements : [];
    for (let index = 1; index < selectionPlacements.length; index += 1) {
      const previous = Number(selectionPlacements[index - 1]?.artwork?.scoreBreakdown?.final ?? Number.NEGATIVE_INFINITY);
      const current = Number(selectionPlacements[index]?.artwork?.scoreBreakdown?.final ?? Number.NEGATIVE_INFINITY);
      if (current > previous + 1e-9) {
        throw new Error(`Selection layout is not sorted by final score at index ${index}.`);
      }
    }
    result.notes.push(`placementCount=${validation.placementCount}`);
    result.notes.push(`firstArtwork=${validation.firstArtwork.id}:${validation.firstArtwork.title}`);
    result.notes.push(
      `selection=${selections
        .map((selection) => `${selection.category}:${selection.option.optionKey ?? selection.option.id}`)
        .join(',')}`,
    );
  } catch (error) {
    result.errors.push({
      type: 'exception',
      text: error instanceof Error ? error.stack || error.message : String(error),
    });
  }

  finalizeScenario(result, []);

  return result;
};

const runDebugScenario = async (browser, recorder) => {
  const result = buildScenarioResult('debug-page');
  const { page, context } = await createAuthenticatedPage(
    browser,
    recorder,
    result.name,
    { width: 1440, height: 1200 },
  );

  try {
    await page.goto(apiUrl('/#/debug/recommendation'), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.getByRole('heading', { name: /최종 추출 50개 작품 리스트/ }).waitFor({
      state: 'attached',
      timeout: 15000,
    });
    result.screenshot = await saveScreenshot(page, 'debug-page.png');
  } catch (error) {
    result.errors.push({
      type: 'exception',
      text: error instanceof Error ? error.stack || error.message : String(error),
    });
  } finally {
    const errors = recorder.relevantErrors(result.name);
    finalizeScenario(result, errors);
    await page.close();
    await context.close();
  }

  return result;
};

async function main() {
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  const hasTestDb = Boolean(process.env.TEST_DB_PATH);
  const smokeSuite = process.env.SMOKE_SUITE ?? (hasTestDb ? 'testdb' : 'core');

  console.log('[smoke] loading backend curation options');
  const options = await loadCurationOptions();
  console.log(
    `[smoke] backend axes: ${options.axes.map((axis) => `${axis.category}:${axis.options.length}`).join(', ')}`,
  );

  const browser = await chromium.launch({
    headless: true,
    ...(resolveExecutablePath() ? { executablePath: resolveExecutablePath() } : {}),
  });

  const recorder = createRecorder();
  const results = [];

  try {
    if (smokeSuite === 'core') {
      console.log('[smoke] published spaces api scenario');
      results.push(await runPublishedSpaceApiScenario());
      console.log('[smoke] default curation scenario');
      results.push(await runDefaultCurationScenario());
      console.log('[smoke] selection curation scenario');
      results.push(await runSelectionScenario(options.axes));
    } else if (smokeSuite === 'ui') {
      console.log('[smoke] home scenario');
      results.push(await runHomeScenario(browser, recorder));
      console.log('[smoke] protected route redirect scenario');
      results.push(await runProtectedRouteRedirectScenario(browser, recorder));
      console.log('[smoke] viewer story TTS button scenario');
      results.push(await runViewerStoryTtsButtonScenario(browser, recorder));
      console.log('[smoke] public space library scenario');
      results.push(await runPublishedSpaceLibraryScenario(browser, recorder));
      console.log('[smoke] debug scenario');
      results.push(await runDebugScenario(browser, recorder));
    } else if (smokeSuite === 'testdb') {
      console.log('[smoke] curator GLB upload scenario');
      results.push(await runCuratorGlbUploadScenario(browser, recorder));
      console.log('[smoke] room merge assembly scenario');
      results.push(await runRoomMergeAssemblyScenario(browser, recorder));
      console.log('[smoke] curator profile owned assets scenario');
      results.push(await runCuratorProfileOwnedAssetsScenario(browser, recorder));
      console.log('[smoke] storytelling tts scenario');
      results.push(await runStorytellingTtsScenario());
    } else {
      throw new Error(`Unknown SMOKE_SUITE: ${smokeSuite}`);
    }
  } finally {
    // Keep summary emission independent from browser shutdown behavior.
  }

  const summary = {
    baseUrl: BASE_URL,
    artifactDir: ARTIFACT_DIR,
    scenarios: results,
    errorCount: results.reduce((count, scenario) => count + scenario.errors.length, 0),
    backendAxes: options.axes.map((axis) => ({
      category: axis.category,
      optionCount: axis.options.length,
    })),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (results.some((scenario) => scenario.status !== 'passed')) {
    process.exitCode = 1;
  }

  console.log('[smoke] closing browser');
  await closeBrowser(browser);
  console.log('[smoke] done');
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        baseUrl: BASE_URL,
        fatal: error instanceof Error ? error.stack || error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
