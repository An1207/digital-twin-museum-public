import { useEffect, useMemo, useState } from 'react';
import { apiService } from '../../lib/api';
import { useCurationStore } from '../../hooks/useCurationStore';
import { resolveArtworkImageUrl } from '../../lib/imagePaths';
import type { RecommendationDebugItem, RecommendationDebugResponse, RecommendationProviderStatus } from '../../types/curation';

type SortKey = 'slot' | 'score' | 'year';

const DEFAULT_SELECTION = {
  themeOptionId: 1,
  eraOptionId: 8,
  emotionOptionId: 10,
};

const sortItems = (items: RecommendationDebugItem[], sortKey: SortKey) => {
  const cloned = [...items];
  if (sortKey === 'score') {
    return cloned.sort((left, right) => (right.scoreBreakdown?.final ?? 0) - (left.scoreBreakdown?.final ?? 0));
  }
  if (sortKey === 'year') {
    return cloned.sort((left, right) => (left.estimatedYear ?? left.eraYear) - (right.estimatedYear ?? right.eraYear));
  }
  return cloned.sort((left, right) => left.slotNumber - right.slotNumber);
};

export const RecommendationDebugPage = () => {
  const { layout, selection } = useCurationStore();
  const [debugData, setDebugData] = useState<RecommendationDebugResponse | null>(null);
  const [providerStatus, setProviderStatus] = useState<RecommendationProviderStatus | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('slot');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestSelection = useMemo(() => {
    if (layout?.themeOption?.id && layout?.eraOption?.id && layout?.emotionOption?.id) {
      return {
        themeOptionId: layout.themeOption.id,
        eraOptionId: layout.eraOption.id,
        emotionOptionId: layout.emotionOption.id,
        sessionId: apiService.getSessionId(),
      };
    }

    if (selection.themeOptionId && selection.eraOptionId && selection.emotionOptionId) {
      return {
        themeOptionId: selection.themeOptionId,
        eraOptionId: selection.eraOptionId,
        emotionOptionId: selection.emotionOptionId,
        sessionId: apiService.getSessionId(),
      };
    }

    return {
      ...DEFAULT_SELECTION,
      sessionId: apiService.getSessionId(),
    };
  }, [layout, selection]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [status, debugResults] = await Promise.all([
          apiService.getRecommendationStatus(),
          apiService.getRecommendationDebugResults(requestSelection),
        ]);
        if (cancelled) return;
        setProviderStatus(status);
        setDebugData(debugResults);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '디버그 결과를 불러오지 못했습니다.');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [requestSelection]);

  const items = useMemo(() => sortItems(debugData?.items ?? [], sortKey), [debugData?.items, sortKey]);

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">Recommendation Debug</p>
            <h1 className="mt-2 text-3xl font-bold">최종 추출 50개 작품 리스트</h1>
            <p className="mt-2 text-sm text-stone-400">
              현재 선택 조합 기준으로 정렬된 50개 결과와 provider 상태를 함께 확인합니다.
            </p>
          </div>
          <a
            href="#"
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-stone-200 transition hover:border-white/20 hover:bg-white/10"
          >
            메인으로 돌아가기
          </a>
        </div>

        <div className="mb-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-lg font-semibold">작품 유사도는 어떻게 계산되나</h2>
            <div className="mt-3 space-y-2 text-sm text-stone-300">
              <p><strong className="text-stone-100">시각 유사도 35%</strong>: 선택한 테마·시대·감정을 문장으로 만든 뒤 CLIP으로 벡터화하고, 작품 이미지 벡터와 얼마나 비슷한지 봅니다.</p>
              <p><strong className="text-stone-100">테마 일치 20%</strong>: 작품이 자연/민속/도시/전쟁 중 어느 쪽에 가까운지 점수를 비교합니다.</p>
              <p><strong className="text-stone-100">시대 일치 15%</strong>: 추정 연도에서 파생된 시대 버킷과 사용자가 고른 시대가 맞는지 봅니다.</p>
              <p><strong className="text-stone-100">감정 일치 30%</strong>: 평온/역동/슬픔/경이 중 어떤 감정이 강한지 비교합니다.</p>
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-lg font-semibold">Provider 역할</h2>
            <div className="mt-3 space-y-2 text-sm text-stone-300">
              <p><strong className="text-stone-100">Visual Provider</strong>: 이미지와 검색 문장을 embedding으로 바꿔서 “겉보기로 얼마나 비슷한가”를 계산합니다.</p>
              <p><strong className="text-stone-100">Meta Provider</strong>: 이미지와 manifest 힌트를 보고 연도, 시대, 감정, 태그, 요약을 추론합니다.</p>
              <p><strong className="text-stone-100">Fallback</strong>: provider가 준비되지 않아도 source API와 heuristic으로 파이프라인은 계속 동작합니다.</p>
            </div>
          </section>
        </div>

        <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_1fr_1fr]">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Current Selection</p>
            <p className="mt-2 text-sm text-stone-200">
              {debugData
                ? `${debugData.selection.themeOption.labelKo} · ${debugData.selection.eraOption.labelKo} · ${debugData.selection.emotionOption.labelKo}`
                : '불러오는 중'}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Providers</p>
            <p className="mt-2 text-sm text-stone-200">
              Visual: {providerStatus?.visualProviderName ?? 'fallback'} / Meta: {providerStatus?.metaProviderName ?? 'fallback'}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Feature Status</p>
            <p className="mt-2 text-sm text-stone-200">
              {providerStatus?.readyCount ?? 0} / {providerStatus?.featureCount ?? 0} ready
            </p>
          </div>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <button
            onClick={() => setSortKey('slot')}
            className={`rounded-lg px-3 py-2 text-sm ${sortKey === 'slot' ? 'bg-amber-500 text-white' : 'bg-white/5 text-stone-300'}`}
          >
            추천 순서
          </button>
          <button
            onClick={() => setSortKey('score')}
            className={`rounded-lg px-3 py-2 text-sm ${sortKey === 'score' ? 'bg-amber-500 text-white' : 'bg-white/5 text-stone-300'}`}
          >
            최종 점수
          </button>
          <button
            onClick={() => setSortKey('year')}
            className={`rounded-lg px-3 py-2 text-sm ${sortKey === 'year' ? 'bg-amber-500 text-white' : 'bg-white/5 text-stone-300'}`}
          >
            연도
          </button>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-sm text-stone-400">불러오는 중...</div>
        ) : error ? (
          <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-8 text-sm text-red-200">{error}</div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-stone-900/80">
            <div className="grid grid-cols-[64px_72px_1.3fr_0.8fr_0.6fr_0.8fr_0.7fr_1.4fr] gap-3 border-b border-white/10 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400">
              <span>순위</span>
              <span>이미지</span>
              <span>작품</span>
              <span>연도·시대</span>
              <span>점수</span>
              <span>Provider</span>
              <span>Source</span>
              <span>근거</span>
            </div>
            <div className="max-h-[72vh] overflow-y-auto">
              {items.map((item) => (
                <div
                  key={`${item.slotNumber}-${item.id}`}
                  className="grid grid-cols-[64px_72px_1.3fr_0.8fr_0.6fr_0.8fr_0.7fr_1.4fr] gap-3 border-b border-white/5 px-4 py-3 text-sm"
                >
                  <div>
                    <div className="font-semibold text-amber-300">#{item.slotNumber}</div>
                    <div className="mt-1 text-[11px] text-stone-500">ID {item.id}</div>
                  </div>
                  <img
                    src={resolveArtworkImageUrl(item.imagePath)}
                    alt={item.title}
                    className="h-14 w-14 rounded-lg object-cover ring-1 ring-white/10"
                    loading="lazy"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-stone-100">{item.title}</p>
                    <p className="truncate text-xs text-stone-400">{item.artist || 'Unknown Artist'}</p>
                    <p className="mt-1 truncate text-[11px] text-stone-500">{item.sourceQuery ?? 'no query'}</p>
                    {item.objectUrl ? (
                      <a className="mt-1 block truncate text-[11px] text-sky-300" href={item.objectUrl} target="_blank" rel="noreferrer">
                        source link
                      </a>
                    ) : null}
                  </div>
                  <div>
                    <div className="font-medium text-stone-100">{item.yearDisplay ?? 'Unknown year'}</div>
                    <div className="mt-1 text-xs text-stone-400">{item.originPeriod}</div>
                  </div>
                  <div>
                    <div className="font-semibold text-stone-100">{item.scoreBreakdown?.final?.toFixed(2) ?? '0.00'}</div>
                    <div className="mt-1 text-[11px] text-stone-500">
                      V {item.scoreBreakdown?.visual?.toFixed(2) ?? '0.00'} / T {item.scoreBreakdown?.theme?.toFixed(2) ?? '0.00'}
                    </div>
                    <div className="text-[11px] text-stone-500">
                      E {item.scoreBreakdown?.era?.toFixed(2) ?? '0.00'} / M {item.scoreBreakdown?.emotion?.toFixed(2) ?? '0.00'}
                    </div>
                  </div>
                  <div className="text-[11px] text-stone-400">
                    <div>V: {item.providerMeta?.visualProvider ?? 'fallback'}</div>
                    <div>M: {item.providerMeta?.metaProvider ?? 'fallback'}</div>
                    <div className="mt-1 text-stone-500">{item.providerMeta?.metadataSource ?? 'unknown'}</div>
                  </div>
                  <div className="text-[11px] text-stone-400">
                    <div>{item.source ?? 'unknown'}</div>
                    <div className="mt-1 break-all text-stone-500">{item.sourceObjectId ?? 'n/a'}</div>
                  </div>
                  <div className="text-[11px] text-stone-300">
                    {item.recommendationReasons?.length ? (
                      <p>{item.recommendationReasons.join(' · ')}</p>
                    ) : null}
                    {item.estimatedYearReason ? (
                      <p className="mt-2 text-stone-500">{item.estimatedYearReason}</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RecommendationDebugPage;
