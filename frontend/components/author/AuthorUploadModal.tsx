import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { apiService } from '../../lib/api';
import type { AuthorArtworkCreateResponse } from '../../types/curation';

interface AuthorUploadModalProps {
  onClose: () => void;
  onSuccess?: (artwork: AuthorArtworkCreateResponse) => void | Promise<void>;
}

type UploadStep = 'form' | 'uploading' | 'success';

const THEME_OPTIONS = ['자연', '민속', '도시', '전쟁'];
const EMOTION_OPTIONS = ['평온', '역동', '슬픔', '경이'];
const ERA_OPTIONS = ['고대', '중세', '르네상스·바로크', '18-19세기', '근현대'];

const normalizeArtworkStatus = (status?: string | null) => (status ?? '').trim().toLowerCase();

const deriveUploadStage = (status?: string | null) => {
  if (!status) {
    return '이미지 업로드 중';
  }
  switch (normalizeArtworkStatus(status)) {
    case 'ready':
      return '작업공간 반영 중';
    case 'generating':
      return '3D GLB 생성 중';
    case 'failed':
      return '생성 실패';
    case 'queued':
    case 'uploaded':
    default:
      return '업로드 완료, 생성 대기 중';
  }
};

const deriveUploadStageDetail = (status?: string | null) => {
  if (!status) {
    return '이미지를 서버로 전송하는 중입니다.';
  }
  switch (normalizeArtworkStatus(status)) {
    case 'ready':
      return '생성이 끝났습니다. 작업공간 목록에 반영하는 중입니다.';
    case 'generating':
      return '서버에서 framed GLB를 백그라운드로 생성하고 있습니다.';
    case 'failed':
      return 'GLB 생성에 실패했습니다. 오류 메시지를 확인하세요.';
    case 'queued':
    case 'uploaded':
    default:
      return '이미지는 저장되었습니다. GLB 생성 작업이 대기열에 들어갔습니다.';
  }
};

export const AuthorUploadModal = ({ onClose, onSuccess }: AuthorUploadModalProps) => {
  const [step, setStep] = useState<UploadStep>('form');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [eraYear, setEraYear] = useState('2024');
  const [mainThema, setMainThema] = useState('자연');
  const [mainEmotion, setMainEmotion] = useState('평온');
  const [era, setEra] = useState('근현대');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AuthorArtworkCreateResponse | null>(null);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const uploadTargetProgress = useMemo(() => {
    if (step === 'success') {
      return 100;
    }
    if (step !== 'uploading') {
      return 0;
    }

    switch (normalizeArtworkStatus(uploadStatus)) {
      case 'ready':
        return 100;
      case 'generating':
        return 72;
      case 'failed':
        return 92;
      case 'queued':
      case 'uploaded':
        return 38;
      default:
        return 18;
    }
  }, [step, uploadStatus]);

  useEffect(() => {
    if (step === 'success') {
      setUploadProgress(100);
      return;
    }

    if (step !== 'uploading') {
      setUploadProgress(0);
      return;
    }

    const timer = window.setInterval(() => {
      setUploadProgress((current) => {
        const target = uploadTargetProgress;
        if (current >= target) {
          return current;
        }
        const stepSize = target >= 70 ? 2 : 3;
        return Math.min(target, current + stepSize);
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [step, uploadTargetProgress]);

  const uploadStage = useMemo(
    () => deriveUploadStage(step === 'uploading' ? uploadStatus : step === 'success' ? 'uploaded' : null),
    [step, uploadStatus]
  );

  const uploadStageDetail = useMemo(() => {
    if (step === 'success') {
      return '작품 레코드가 저장되었습니다. GLB 생성은 작업공간에서 백그라운드로 계속 진행됩니다.';
    }
    if (step !== 'uploading') {
      return '업로드를 시작하면 상태가 표시됩니다.';
    }
    return deriveUploadStageDetail(uploadStatus);
  }, [step, uploadStatus]);

  const resultStatusLabel = useMemo(() => {
    if (!result) {
      return '';
    }

    switch (normalizeArtworkStatus(result.status)) {
      case 'ready':
        return 'GLB 준비 완료';
      case 'generating':
        return 'GLB 생성 중';
      case 'failed':
        return 'GLB 생성 실패';
      case 'queued':
      case 'uploaded':
      default:
        return 'GLB 생성 대기 중';
    }
  }, [result]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) {
      setError('이미지 파일을 선택해주세요.');
      return;
    }

    setStep('uploading');
    setError(null);
    setUploadStatus(null);
    setUploadProgress(12);

    const formData = new FormData();
    formData.append('image', file);
    formData.append('title', title.trim());
    formData.append('artist', artist.trim());
    formData.append('era_year', eraYear.trim());
    formData.append('main_thema', mainThema);
    formData.append('main_emotion', mainEmotion);
    formData.append('era', era);

    try {
      const created = await apiService.createAuthorArtwork(formData);
      setResult(created);
      setUploadStatus(created.status ?? 'queued');
      setStep('success');
      void Promise.resolve(onSuccess?.(created)).catch((callbackError) => {
        console.error('Author upload success callback failed', callbackError);
      });
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : '업로드 또는 GLB 생성에 실패했습니다.';
      setError(message);
      setStep('form');
    }
  };

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/70 backdrop-blur-md"
        onClick={step === 'uploading' ? undefined : onClose}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 16 }}
        transition={{ duration: 0.24, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-4xl overflow-hidden rounded-[28px] border border-white/10 bg-stone-950/95 shadow-[0_25px_100px_rgba(0,0,0,0.45)]"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.18),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.05),transparent)] pointer-events-none" />

        <div className="relative flex items-center justify-between border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-300">Author Studio</p>
            <h2 className="mt-2 text-2xl font-bold text-stone-100">작가 업로드 및 가변 액자 생성</h2>
            <p className="mt-1 text-sm text-stone-400">
              이미지를 업로드하면 작품 레코드가 저장되고 framed GLB는 백그라운드에서 생성됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={step === 'uploading'}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-stone-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            닫기
          </button>
        </div>

        <div className="border-b border-white/10 bg-white/5 px-6 py-4">
          <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
            <span>{step === 'success' ? '완료' : step === 'uploading' ? uploadStage : '진행 상태'}</span>
            <span>{step === 'success' ? '100%' : `${uploadProgress}%`}</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                step === 'success' ? 'bg-emerald-400' : 'bg-amber-300'
              }`}
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-stone-400">
            {uploadStageDetail}
          </p>
          {step === 'uploading' ? (
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-medium text-stone-300">
              <span
                className={`rounded-full border px-3 py-1 ${
                  ['queued', 'uploaded'].includes(normalizeArtworkStatus(uploadStatus))
                    ? 'border-amber-300/40 bg-amber-300/10 text-amber-100'
                    : 'border-white/10 bg-white/5'
                }`}
              >
                이미지
              </span>
              <span
                className={`rounded-full border px-3 py-1 ${
                  normalizeArtworkStatus(uploadStatus) === 'generating'
                    ? 'border-amber-300/40 bg-amber-300/10 text-amber-100'
                    : 'border-white/10 bg-white/5'
                }`}
              >
                GLB
              </span>
              <span
                className={`rounded-full border px-3 py-1 ${
                  normalizeArtworkStatus(uploadStatus) === 'ready'
                    ? 'border-emerald-300/40 bg-emerald-300/10 text-emerald-100'
                    : 'border-white/10 bg-white/5'
                }`}
              >
                반영
              </span>
            </div>
          ) : null}
        </div>

        <AnimatePresence mode="wait">
          {step === 'success' && result ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="relative grid gap-6 px-6 py-6 lg:grid-cols-[280px_minmax(0,1fr)]"
            >
              <img
                src={result.imagePath || ''}
                alt={result.title ?? `Artwork ${result.artworkId}`}
                className="h-[280px] w-full rounded-3xl object-cover ring-1 ring-white/10"
              />
              <div className="rounded-3xl border border-emerald-400/20 bg-emerald-500/10 p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">업로드 접수 완료</p>
                <h3 className="mt-3 text-2xl font-bold text-stone-100">{result.title}</h3>
                <p className="mt-2 text-stone-300">{result.artist}</p>
                <div className="mt-4 space-y-2 text-sm text-stone-300">
                  <p>Artwork ID: {result.artworkId}</p>
                  <p>Status: {resultStatusLabel}</p>
                  <p>Folder: {result.assetFolderName}</p>
                  <p>File: {result.fileName}</p>
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-stone-200 transition hover:bg-white/10"
                  >
                    작품 리스트로 돌아가기
                  </button>
                </div>
                <p className="mt-4 text-xs text-stone-500">
                  업로드가 접수되었습니다. 작업공간의 작품 리스트에서 GLB 생성 상태를 확인하세요.
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.form
              key="form"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              onSubmit={handleSubmit}
              className="relative grid gap-6 px-6 py-6 lg:grid-cols-[320px_minmax(0,1fr)]"
            >
              <div className="space-y-4">
                <div className="rounded-3xl border border-dashed border-white/15 bg-black/20 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Step 1. Image</p>
                  <label className="mt-3 flex min-h-[280px] cursor-pointer flex-col items-center justify-center rounded-[24px] border border-white/10 bg-white/5 px-4 py-6 text-center transition hover:border-white/20 hover:bg-white/10">
                    {previewUrl ? (
                      <img src={previewUrl} alt="Upload preview" className="h-full max-h-[240px] w-full rounded-2xl object-cover" />
                    ) : (
                      <>
                        <span className="text-base font-medium text-stone-100">이미지를 선택하세요</span>
                        <span className="mt-2 text-sm text-stone-400">JPEG, PNG, WEBP, HEIC / 최대 10MB</span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                      className="hidden"
                      onChange={(event) => {
                        const nextFile = event.target.files?.[0] ?? null;
                        setFile(nextFile);
                        setError(null);
                      }}
                    />
                  </label>
                  {file ? (
                    <p className="mt-3 truncate text-xs text-stone-400">{file.name}</p>
                  ) : null}
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Step 2. Metadata</p>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-sm text-stone-300">작품명</span>
                      <input
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        required
                        className="w-full rounded-2xl border border-white/10 bg-stone-950/80 px-4 py-3 text-sm text-stone-100 outline-none transition focus:border-amber-400/40"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm text-stone-300">작가명</span>
                      <input
                        value={artist}
                        onChange={(event) => setArtist(event.target.value)}
                        required
                        className="w-full rounded-2xl border border-white/10 bg-stone-950/80 px-4 py-3 text-sm text-stone-100 outline-none transition focus:border-amber-400/40"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm text-stone-300">연도</span>
                      <input
                        type="number"
                        min={0}
                        max={3000}
                        value={eraYear}
                        onChange={(event) => setEraYear(event.target.value)}
                        required
                        className="w-full rounded-2xl border border-white/10 bg-stone-950/80 px-4 py-3 text-sm text-stone-100 outline-none transition focus:border-amber-400/40"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm text-stone-300">시대</span>
                      <select
                        value={era}
                        onChange={(event) => setEra(event.target.value)}
                        className="w-full rounded-2xl border border-white/10 bg-stone-950/80 px-4 py-3 text-sm text-stone-100 outline-none transition focus:border-amber-400/40"
                      >
                        {ERA_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm text-stone-300">주 테마</span>
                      <select
                        value={mainThema}
                        onChange={(event) => setMainThema(event.target.value)}
                        className="w-full rounded-2xl border border-white/10 bg-stone-950/80 px-4 py-3 text-sm text-stone-100 outline-none transition focus:border-amber-400/40"
                      >
                        {THEME_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm text-stone-300">주 감정</span>
                      <select
                        value={mainEmotion}
                        onChange={(event) => setMainEmotion(event.target.value)}
                        className="w-full rounded-2xl border border-white/10 bg-stone-950/80 px-4 py-3 text-sm text-stone-100 outline-none transition focus:border-amber-400/40"
                      >
                        {EMOTION_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Step 3. Generate</p>
                  <p className="mt-3 text-sm text-stone-400">
                    업로드가 접수되면 작품 레코드가 저장되고, 기존 framed GLB 생성기를 재사용해 백그라운드에서 GLB를 만듭니다.
                  </p>
                  {error ? (
                    <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                      {error}
                    </div>
                  ) : null}
                  <div className="mt-5 flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={step === 'uploading'}
                      className="rounded-2xl border border-amber-400/30 bg-amber-500/15 px-5 py-3 text-sm font-medium text-amber-100 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {step === 'uploading' ? '업로드 중...' : '업로드 시작'}
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      disabled={step === 'uploading'}
                      className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-stone-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      취소
                    </button>
                  </div>
                </div>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

export default AuthorUploadModal;
