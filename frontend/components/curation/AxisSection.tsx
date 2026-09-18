import React from 'react';
import type { CurationAxis, Category } from '../../types/curation';
import { useUiLocale } from '../../lib/uiLocale';
import { OptionCard } from './OptionCard';

interface AxisSectionProps {
  axis: CurationAxis;
  selectedOptionId: number | null;
  onSelect: (optionId: number) => void;
}

const categoryLabels: Record<Category, { ko: string; en: string; descriptionKo: string; descriptionEn: string }> = {
  theme: {
    ko: '주제',
    en: 'Theme',
    descriptionKo: '작품의 서사와 분위기를 이끄는 중심 주제를 고릅니다.',
    descriptionEn: 'Choose the central theme that shapes the exhibition narrative.',
  },
  era: {
    ko: '시대',
    en: 'Era',
    descriptionKo: '시대의 결을 따라 감상의 리듬을 정합니다.',
    descriptionEn: 'Set the viewing rhythm by the era you want to explore.',
  },
  emotion: {
    ko: '감정',
    en: 'Emotion',
    descriptionKo: '감상의 온도를 정하는 감정의 방향을 고릅니다.',
    descriptionEn: 'Choose the emotional tone for the experience.',
  },
};

const categoryAccent: Record<Category, { wrapper: string; label: string; border: string }> = {
  theme: {
    wrapper: 'bg-[#7f9b5a]/18 text-[#e8f0d5]',
    label: 'text-[#7f9b5a]',
    border: 'border-[#7f9b5a]/28',
  },
  era: {
    wrapper: 'bg-[#5b2c20]/18 text-[#f0d7cf]',
    label: 'text-[#d1a293]',
    border: 'border-[#b57d69]/28',
  },
  emotion: {
    wrapper: 'bg-[#e8f0d5]/10 text-[#f4efe7]',
    label: 'text-[#d8cbbb]',
    border: 'border-white/10',
  },
};

const categoryIcons: Record<Category, React.ReactNode> = {
  theme: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
    </svg>
  ),
  era: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  emotion: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
    </svg>
  ),
};

export const AxisSection = ({ axis, selectedOptionId, onSelect }: AxisSectionProps) => {
  const { locale } = useUiLocale();
  const isKorean = locale === 'ko';
  const label = categoryLabels[axis.category];
  const accent = categoryAccent[axis.category];
  const { title, description } = {
    title: isKorean ? label.ko : label.en,
    description: isKorean ? label.descriptionKo : label.descriptionEn,
  };

  return (
    <section data-testid={`axis-${axis.category}`} className="mb-8">
      <div className={`relative mb-4 overflow-hidden rounded-[22px] border bg-[#1b1812]/70 p-4 backdrop-blur-xl ${accent.border}`}>
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(127, 155, 90,0.08),transparent_42%,rgba(91,44,32,0.08)_100%)]" />
        <div className="pointer-events-none absolute left-1/2 top-0 h-px w-1/2 -translate-x-1/2 bg-gradient-to-r from-transparent via-white/20 to-transparent" />

        <div className="relative z-10 flex items-center gap-3">
          <div className={`rounded-xl border p-2 ${accent.wrapper} ${accent.border}`}>
            {categoryIcons[axis.category]}
          </div>
          <div>
            <h3 className="text-lg font-semibold tracking-normal text-[#f4efe7]">{title}</h3>
            <p className="text-sm leading-6 text-[#b29e8d]">{description}</p>
          </div>
        </div>
      </div>

      {/* Option Cards Grid */}
      <div className="grid grid-cols-2 gap-3">
        {axis.options.map((option) => (
          <OptionCard
            key={option.id}
            option={option}
            isSelected={selectedOptionId === option.id}
            onClick={() => onSelect(option.id)}
            testId={`option-${axis.category}-${option.optionKey ?? option.id}`}
          />
        ))}
      </div>
    </section>
  );
};

export default AxisSection;
