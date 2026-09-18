import { useEffect } from 'react';

interface ToastProps {
  message: string;
  type?: 'error' | 'success' | 'info';
  onClose: () => void;
  duration?: number;
}

const toastStyles = {
  error: {
    bg: 'bg-[#5b2c20]/70',
    border: 'border-[#b57d69]/35',
    icon: 'text-[#f0d7cf]',
    text: 'text-[#f4efe7]',
  },
  success: {
    bg: 'bg-[#2f3d20]/72',
    border: 'border-[#7f9b5a]/35',
    icon: 'text-[#e8f0d5]',
    text: 'text-[#f4efe7]',
  },
  info: {
    bg: 'bg-[#8c6745]/65',
    border: 'border-[#d8cbbb]/22',
    icon: 'text-[#f4efe7]',
    text: 'text-[#f4efe7]',
  },
};

export const Toast = ({ message, type = 'error', onClose, duration = 5000 }: ToastProps) => {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [onClose, duration]);

  const style = toastStyles[type];

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-toast animate-slide-up">
      <div
        className={`relative overflow-hidden backdrop-blur-xl ${style.bg} ${style.border} border rounded-xl px-6 py-3 shadow-[0_24px_70px_rgba(0,0,0,0.45)] flex items-center gap-3 max-w-md`}
      >
        {/* Glass overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/6 to-transparent pointer-events-none" />
        {/* Top shine */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent pointer-events-none" />

        {/* Icon */}
        <span className={`relative z-10 ${style.icon}`}>
          {type === 'error' && (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          )}
          {type === 'success' && (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          {type === 'info' && (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
        </span>

        {/* Message */}
        <span className={`relative z-10 ${style.text}`}>{message}</span>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="relative z-10 ml-2 text-[#d8cbbb]/80 transition-colors hover:text-[#f4efe7]"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default Toast;
