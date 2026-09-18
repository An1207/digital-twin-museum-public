import type {
  CurationOptionsResponse,
  LayoutResponse,
} from '../types/curation';

// ============================================================
// Mock Data - 백엔드 없이 UI 테스트용
// ============================================================

export const MOCK_CURATION_OPTIONS: CurationOptionsResponse = {
  axes: [
    {
      category: 'theme',
      label: '테마',
      options: [
        {
          id: 1,
          optionKey: 'folk_life',
          labelKo: '민속·생활',
          sortOrder: 1,
          displayDescription: '생활상과 민속 문화를 중심으로 감상합니다',
        },
        {
          id: 2,
          optionKey: 'nature_landscape',
          labelKo: '자연·산수',
          sortOrder: 2,
          displayDescription: '자연 풍경과 산수 표현을 중심으로 감상합니다',
        },
        {
          id: 3,
          optionKey: 'portrait',
          labelKo: '전쟁·역사',
          sortOrder: 3,
          displayDescription: '인물과 초상화를 중심으로 감상합니다',
        },
        {
          id: 4,
          optionKey: 'east_painting',
          labelKo: '도시·근대',
          sortOrder: 4,
          displayDescription: '동양화의 기법과 표현을 중심으로 감상합니다',
        },
      ],
    },
    {
      category: 'era',
      label: '시대',
      options: [
        {
          id: 5,
          optionKey: 'goryeo',
          labelKo: '고려',
          sortOrder: 1,
          displayDescription: '고려 시대의 작품을 감상합니다',
        },
        {
          id: 6,
          optionKey: 'early_josun',
          labelKo: '조선 전·중기',
          sortOrder: 2,
          displayDescription: '조선 전·중기의 작품을 감상합니다',
        },
        {
          id: 7,
          optionKey: 'late_josun',
          labelKo: '조선 후기',
          sortOrder: 3,
          displayDescription: '조선 후기의 작품을 감상합니다',
        },
        {
          id: 8,
          optionKey: 'modern',
          labelKo: '근·현대',
          sortOrder: 4,
          displayDescription: '근·현대 미술 작품을 감상합니다',
        },
      ],
    },
    {
      category: 'emotion',
      label: '감정',
      options: [
        {
          id: 9,
          optionKey: 'serene',
          labelKo: '평온·고요함',
          sortOrder: 1,
          displayDescription: '고요하고 안정된 감정을 전달하는 작품',
        },
        {
          id: 10,
          optionKey: 'joy',
          labelKo: '역동·긴장감',
          sortOrder: 2,
          displayDescription: '밝고 활기찬 감정을 전달하는 작품',
        },
        {
          id: 11,
          optionKey: 'melancholy',
          labelKo: '슬픔·애잔함',
          sortOrder: 3,
          displayDescription: '그리움과 조용한 슬픔을 전달하는 작품',
        },
        {
          id: 12,
          optionKey: 'awe',
          labelKo: '경이로움',
          sortOrder: 4,
          displayDescription: '웅장함과 경외감을 전달하는 작품',
        },
      ],
    },
  ],
};

// Mock 기본 레이아웃 (테마 선택 없이) - 30개 작품
export const MOCK_DEFAULT_LAYOUT: LayoutResponse = {
  layoutType: 'combined_options',
  themeOption: {
    id: 0,
    category: 'theme',
    optionKey: 'default',
    labelKo: '전체',
  },
  eraOption: {
    id: 0,
    category: 'era',
    optionKey: 'default',
    labelKo: '전체',
  },
  emotionOption: {
    id: 0,
    category: 'emotion',
    optionKey: 'default',
    labelKo: '전체',
  },
  gallery: {
    mapUrl: '/gallery/default',
    entrySlotNumber: 1,
  },
  placements: [
    // 북쪽 전시관 - West Wall (6개) - rotationY: Math.PI/2
    { slotNumber: 1, artwork: { id: 'art-001', title: '후시코다츠', artist: '가츠시카 호쿠사이', originPeriod: '근·현대', eraYear: 1830, descriptionDefault: '후지산의 풍경', imagePath: 'museum_cma_001_katsushika-hokusai-japanese-17601849_south-wind-clear-sky-from-thirty-six-views-of-mount-fuji.jpg' }, position: { x: -16, y: 2.0, z: -22, rotationY: Math.PI / 2 }, sortValue: 1 },
    { slotNumber: 2, artwork: { id: 'art-002', title: '란سل롯', artist: '렘브란트', originPeriod: '근·현대', eraYear: 1648, descriptionDefault: '독실의 초상화', imagePath: 'museum_cma_002_rembrandt-van-rijn-dutch-16061669_self-portrait-drawing-at-a-window.jpg' }, position: { x: -16, y: 2.0, z: -19, rotationY: Math.PI / 2 }, sortValue: 2 },
    { slotNumber: 3, artwork: { id: 'art-003', title: '센강의 풍경', artist: '미상', originPeriod: '근·현대', eraYear: 1850, descriptionDefault: '센강의 풍경', imagePath: 'museum_cma_003_unknown-artist_banks-of-the-seine.jpg' }, position: { x: -16, y: 2.0, z: -16, rotationY: Math.PI / 2 }, sortValue: 3 },
    { slotNumber: 4, artwork: { id: 'art-004', title: '장미', artist: '르누아르', originPeriod: '근·현대', eraYear: 1880, descriptionDefault: '꽃과 항아리', imagePath: 'museum_cma_004_pierre-auguste-renoir-french-18411919_roses-in-a-vase.jpg' }, position: { x: -16, y: 2.0, z: -13, rotationY: Math.PI / 2 }, sortValue: 4 },
    { slotNumber: 5, artwork: { id: 'art-005', title: '체인', artist: '렘브란트', originPeriod: '근·현대', eraYear: 1639, descriptionDefault: '사슬을 든 청년', imagePath: 'museum_cma_005_rembrandt-van-rijn-dutch-16061669-studio_a-young-man-with-a-chain.jpg' }, position: { x: -16, y: 2.0, z: -10, rotationY: Math.PI / 2 }, sortValue: 5 },
    { slotNumber: 6, artwork: { id: 'art-006', title: '여인', artist: '렘브란트', originPeriod: '근·현대', eraYear: 1665, descriptionDefault: '창가의 여자', imagePath: 'museum_cma_006_rembrandt-van-rijn-dutch-16061669-studio_portrait-of-a-woman.jpg' }, position: { x: -16, y: 2.0, z: -7, rotationY: Math.PI / 2 }, sortValue: 6 },
    // 북쪽 전시관 - East Wall (6개) - rotationY: -Math.PI/2
    { slotNumber: 7, artwork: { id: 'art-007', title: '풀빌의 물결', artist: '모네', originPeriod: '근·현대', eraYear: 1882, descriptionDefault: '풀빌의 저류', imagePath: 'museum_cma_007_claude-monet-french-18401926_low-tide-at-pourville-near-dieppe-1882.jpg' }, position: { x: 16, y: 2.0, z: -22, rotationY: -Math.PI / 2 }, sortValue: 7 },
    { slotNumber: 8, artwork: { id: 'art-008', title: '플라타나무', artist: '반 고흐', originPeriod: '근·현대', eraYear: 1888, descriptionDefault: '플라타나무 길', imagePath: 'museum_cma_008_vincent-van-gogh-dutch-18531890_the-large-plane-trees-road-menders-at-saint-remy.jpg' }, position: { x: 16, y: 2.0, z: -19, rotationY: -Math.PI / 2 }, sortValue: 8 },
    { slotNumber: 9, artwork: { id: 'art-009', title: '가셰 박사', artist: '반 고흐', originPeriod: '근·현대', eraYear: 1890, descriptionDefault: '가셰 박사의 초상', imagePath: 'museum_cma_009_vincent-van-gogh-dutch-18531890_dr-gachet.jpg' }, position: { x: 16, y: 2.0, z: -16, rotationY: -Math.PI / 2 }, sortValue: 9 },
    { slotNumber: 10, artwork: { id: 'art-010', title: '수염남', artist: '렘브란트', originPeriod: '근·현대', eraYear: 1638, descriptionDefault: '수염남의 초상', imagePath: 'museum_cma_010_rembrandt-van-rijn-dutch-16061669_a-bearded-man-wearing-a-hat.jpg' }, position: { x: 16, y: 2.0, z: -13, rotationY: -Math.PI / 2 }, sortValue: 10 },
    { slotNumber: 11, artwork: { id: 'art-011', title: '그랑드케이 항구', artist: '다빙니', originPeriod: '근·현대', eraYear: 1882, descriptionDefault: '르아브르의 그랑드케이 항구', imagePath: 'museum_cma_011_charles-francois-daubigny-french-1817187_villerville-seen-from-le-ratier.jpg' }, position: { x: 16, y: 2.0, z: -10, rotationY: -Math.PI / 2 }, sortValue: 11 },
    { slotNumber: 12, artwork: { id: 'art-012', title: '뵤프의 거리', artist: '뷔야르', originPeriod: '근·현대', eraYear: 1885, descriptionDefault: '뵤프의 거리', imagePath: 'museum_cma_012_edouard-vuillard-french-18681940-auguste_on-the-pont-de-leurope.jpg' }, position: { x: 16, y: 2.0, z: -7, rotationY: -Math.PI / 2 }, sortValue: 12 },
    // 동쪽 건물 - North Wall (3개) - rotationY: 0
    { slotNumber: 13, artwork: { id: 'art-013', title: '봄의 꽃', artist: '모네', originPeriod: '근·현대', eraYear: 1886, descriptionDefault: '봄날의 꽃다발', imagePath: 'museum_cma_013_claude-monet-french-18401926_spring-flowers.jpg' }, position: { x: 13, y: 2, z: -3, rotationY: 0 }, sortValue: 13 },
    { slotNumber: 14, artwork: { id: 'art-014', title: '수레와 풍경', artist: '반 고흐', originPeriod: '근·현대', eraYear: 1889, descriptionDefault: '수레와 풍경', imagePath: 'museum_cma_014_vincent-van-gogh-dutch-18531890_landscape-with-wheelbarrow.jpg' }, position: { x: 16, y: 2, z: -3, rotationY: 0 }, sortValue: 14 },
    { slotNumber: 15, artwork: { id: 'art-015', title: '두 사람', artist: '미상', originPeriod: '근·현대', eraYear: 1800, descriptionDefault: '두 사람을 묶는 모습', imagePath: 'museum_cma_015_anonymous_two-men-tying-a-bundle-recto.jpg' }, position: { x: 19, y: 2, z: -3, rotationY: 0 }, sortValue: 15 },
    // 동쪽 건물 - South Wall (3개) - rotationY: Math.PI
    { slotNumber: 16, artwork: { id: 'art-016', title: '다섯 인물', artist: '미상', originPeriod: '근·현대', eraYear: 1800, descriptionDefault: '다섯 명의 인물 습작', imagePath: 'museum_cma_016_anonymous_five-figure-studies-verso.jpg' }, position: { x: 13, y: 2, z: 3, rotationY: Math.PI }, sortValue: 16 },
    { slotNumber: 17, artwork: { id: 'art-017', title: '크리스티', artist: '렘브란트', originPeriod: '근·현대', eraYear: 1648, descriptionDefault: '십자가의 크리스티', imagePath: 'museum_cma_017_rembrandt-van-rijn-dutch-16061669_christ-preaching-la-petite-tombe.jpg' }, position: { x: 16, y: 2, z: 3, rotationY: Math.PI }, sortValue: 17 },
    { slotNumber: 18, artwork: { id: 'art-018', title: '아덜린', artist: '반 고흐', originPeriod: '근·현대', eraYear: 1890, descriptionDefault: '아덜린의 초상', imagePath: 'museum_cma_018_vincent-van-gogh-dutch-18531890_adeline-ravoux.jpg' }, position: { x: 19, y: 2, z: 3, rotationY: Math.PI }, sortValue: 18 },
    // 서쪽 파빌리온 - North Wall (3개) - rotationY: 0
    { slotNumber: 19, artwork: { id: 'art-019', title: '포플라', artist: '반 고흐', originPeriod: '근·현대', eraYear: 1888, descriptionDefault: '알프스의 포플라', imagePath: 'museum_cma_019_vincent-van-gogh-dutch-18531890_two-poplars-in-the-alpilles-near-saint-remy.jpg' }, position: { x: -13, y: 1.5, z: 5, rotationY: 0 }, sortValue: 19 },
    { slotNumber: 20, artwork: { id: 'art-020', title: '빨간 수건의 여인', artist: '모네', originPeriod: '근·현대', eraYear: 1883, descriptionDefault: '빨간 수건의 여인', imagePath: 'museum_cma_020_claude-monet-french-18401926_the-red-kerchief.jpg' }, position: { x: -16, y: 1.5, z: 5, rotationY: 0 }, sortValue: 20 },
    { slotNumber: 21, artwork: { id: 'art-021', title: '십자가', artist: '렘브란트', originPeriod: '근·현대', eraYear: 1650, descriptionDefault: '십자가의 크리스티', imagePath: 'museum_cma_021_rembrandt-van-rijn-dutch-16061669_christ-crucified-between-the-two-thieves-the-three-crosses.jpg' }, position: { x: -19, y: 1.5, z: 5, rotationY: 0 }, sortValue: 21 },
    // 서쪽 파빌리온 - South Wall (3개) - rotationY: Math.PI
    { slotNumber: 22, artwork: { id: 'art-022', title: '사와', artist: '렘브란트', originPeriod: '근·현대', eraYear: 1635, descriptionDefault: '사와의 초상', imagePath: 'museum_cma_022_rembrandt-van-rijn-dutch-16061669_rembrandt-and-his-wife-saskia.jpg' }, position: { x: -13, y: 1.5, z: 11, rotationY: Math.PI }, sortValue: 22 },
    { slotNumber: 23, artwork: { id: 'art-023', title: '르아브르', artist: '카테', originPeriod: '근·현대', eraYear: 1885, descriptionDefault: '르아브르의 운하', imagePath: 'museum_cma_023_siebe-johannes-ten-cate-dutch-18581908_the-grand-quai-of-le-havre.jpg' }, position: { x: -16, y: 1.5, z: 11, rotationY: Math.PI }, sortValue: 23 },
    { slotNumber: 24, artwork: { id: 'art-024', title: '카이아파', artist: '렘브란트', originPeriod: '근·현대', eraYear: 1660, descriptionDefault: '카이아파 앞의 크리스티', imagePath: 'museum_cma_024_rembrandt-van-rijn-dutch-16061669_christ-taken-before-caiaphas.jpg' }, position: { x: -19, y: 1.5, z: 11, rotationY: Math.PI }, sortValue: 24 },
    // 중앙 거울못 주변 - 공개 전시 (6개)
    { slotNumber: 25, artwork: { id: 'art-025', title: '수련', artist: '모네', originPeriod: '근·현대', eraYear: 1900, descriptionDefault: '수련의 연못', imagePath: 'museum_cma_025_claude-monet-french-18401926_water-lilies-agapanthus.jpg' }, position: { x: -4, y: 1.5, z: 4, rotationY: -0.5 }, sortValue: 25 },
    { slotNumber: 26, artwork: { id: 'art-026', title: '생 마메', artist: '시슬리', originPeriod: '근·현대', eraYear: 1883, descriptionDefault: '생 마메의 운하', imagePath: 'museum_cma_026_alfred-sisley-french-18401899_saint-mammes-loing-canal.jpg' }, position: { x: 4, y: 1.5, z: 4, rotationY: 0.5 }, sortValue: 26 },
    { slotNumber: 27, artwork: { id: 'art-027', title: '마르타', artist: '렘브란트', originPeriod: '근·현대', eraYear: 1655, descriptionDefault: '마르타와 마리아', imagePath: 'museum_cma_027_rembrandt-van-rijn-dutch-16061669_the-meeting-of-christ-with-martha-and-mary-after-the-death-of-lazarus.jpg' }, position: { x: -4, y: 1.5, z: -4, rotationY: 0.5 }, sortValue: 27 },
    { slotNumber: 28, artwork: { id: 'art-028', title: '염소 소녀', artist: '코로', originPeriod: '근·현대', eraYear: 1862, descriptionDefault: '개울가의 염소 소녀', imagePath: 'museum_cma_028_jean-baptiste-camille-corot-french-17961_lormes-goat-girl-sitting-beside-a-stream-in-a-forest.jpg' }, position: { x: 4, y: 1.5, z: -4, rotationY: -0.5 }, sortValue: 28 },
    { slotNumber: 29, artwork: { id: 'art-029', title: '기도', artist: '렘브란트', originPeriod: '근·현대', eraYear: 1635, descriptionDefault: '기도하는 노인', imagePath: 'museum_cma_029_rembrandt-van-rijn-dutch-16061669_an-elderly-man-in-prayer.jpg' }, position: { x: 0, y: 1.5, z: 6, rotationY: 0 }, sortValue: 29 },
    { slotNumber: 30, artwork: { id: 'art-030', title: '토비아스', artist: '렘브란트', originPeriod: '근·현대', eraYear: 1635, descriptionDefault: ' 아버지의 눈을 고치는 토비아스', imagePath: 'museum_cma_030_rembrandt-van-rijn-dutch-16061669_tobias-healing-his-fathers-blindness.jpg' }, position: { x: 0, y: 1.5, z: -6, rotationY: Math.PI }, sortValue: 30 },
  ],
};

// Mock 큐레이션 레이아웃 - 30개 작품
export const MOCK_LAYOUT_RESPONSE: LayoutResponse = {
  layoutType: 'combined_options',
  themeOption: {
    id: 2,
    category: 'theme',
    optionKey: 'nature_landscape',
    labelKo: '자연·산수',
  },
  eraOption: {
    id: 7,
    category: 'era',
    optionKey: 'late_josun',
    labelKo: '조선 후기',
  },
  emotionOption: {
    id: 9,
    category: 'emotion',
    optionKey: 'serene',
    labelKo: '평온·고요함',
  },
  gallery: {
    mapUrl: '/gallery/nature-latejosun-serene',
    entrySlotNumber: 1,
  },
  placements: [
    // 북쪽 전시관 - West Wall (6개)
    { slotNumber: 1, artwork: { id: 'art-101', title: '후시코다츠', artist: '가츠시카 호쿠сай', originPeriod: '근·현대', eraYear: 1830, descriptionDefault: '후지산의 풍경', imagePath: 'museum_cma_031_piet-mondrian-dutch-18721944_landscape-at-loosduinen.jpg' }, position: { x: -16, y: 2.0, z: -22, rotationY: Math.PI / 2 }, sortValue: 1 },
    { slotNumber: 2, artwork: { id: 'art-102', title: '란슬롯', artist: '렘브란트', originPeriod: '근·현대', eraYear: 1648, descriptionDefault: '독실의 초상화', imagePath: 'museum_cma_032_rembrandt-van-rijn-dutch-16061669_the-strolling-musicians.jpg' }, position: { x: -16, y: 2.0, z: -19, rotationY: Math.PI / 2 }, sortValue: 2 },
    { slotNumber: 3, artwork: { id: 'art-103', title: '표범', artist: '렘브란트 부가티', originPeriod: '근·현대', eraYear: 1915, descriptionDefault: '걷는 표범', imagePath: 'museum_cma_033_rembrandt-bugatti-italian-18841916_walking-panther.jpg' }, position: { x: -16, y: 2.0, z: -16, rotationY: Math.PI / 2 }, sortValue: 3 },
    { slotNumber: 4, artwork: { id: 'art-104', title: '롯과 딸들', artist: '판브리에트', originPeriod: '근·현대', eraYear: 1630, descriptionDefault: '롯과 딸들의 그림', imagePath: 'museum_cma_034_jan-georg-van-vliet-dutch-c-16101635-rem_lot-and-his-daughters.jpg' }, position: { x: -16, y: 2.0, z: -13, rotationY: Math.PI / 2 }, sortValue: 4 },
    { slotNumber: 5, artwork: { id: 'art-105', title: '샤함한', artist: '렘브란트', originPeriod: '근·현대', eraYear: 1635, descriptionDefault: '샤함한의 초상', imagePath: 'museum_cma_035_rembrandt-van-rijn-dutch-16061669_shah-jahan.jpg' }, position: { x: -16, y: 2.0, z: -10, rotationY: Math.PI / 2 }, sortValue: 5 },
    { slotNumber: 6, artwork: { id: 'art-106', title: '모네', artist: '폴 폴랭', originPeriod: '근·현대', eraYear: 1920, descriptionDefault: '모네의 초상', imagePath: 'museum_cma_036_paul-paulin-french-18521937_claude-monet.jpg' }, position: { x: -16, y: 2.0, z: -7, rotationY: Math.PI / 2 }, sortValue: 6 },
    // 북쪽 전시관 - East Wall (6개)
    { slotNumber: 7, artwork: { id: 'art-107', title: '건축 현장', artist: '브레이트너', originPeriod: '근·현대', eraYear: 1890, descriptionDefault: '암스테르담의 건설 현장', imagePath: 'museum_cma_037_george-hendrik-breitner-dutch-18571923_construction-site-in-amsterdam.jpg' }, position: { x: 16, y: 2.0, z: -22, rotationY: -Math.PI / 2 }, sortValue: 7 },
    { slotNumber: 8, artwork: { id: 'art-108', title: '백시의 시', artist: '가츠시카 호쿠사이', originPeriod: '근·현대', eraYear: 1835, descriptionDefault: '백시의 시', imagePath: 'museum_cma_038_katsushika-hokusai-japanese-17601849_poem-by-minamoto-no-muneyuki-from-the-series-one-hundred-poems-by-one-hundred-po.jpg' }, position: { x: 16, y: 2.0, z: -19, rotationY: -Math.PI / 2 }, sortValue: 8 },
    { slotNumber: 9, artwork: { id: 'art-109', title: '교회', artist: '발두스', originPeriod: '근·현대', eraYear: 1875, descriptionDefault: '오베르의 교회', imagePath: 'museum_cma_039_edouard-baldus-french-18131889_church-at-auvers.jpg' }, position: { x: 16, y: 2.0, z: -16, rotationY: -Math.PI / 2 }, sortValue: 9 },
    { slotNumber: 10, artwork: { id: 'art-110', title: '센강의 풍경', artist: '용캥', originPeriod: '근·현대', eraYear: 1885, descriptionDefault: '바믐드의 센강', imagePath: 'museum_cma_040_johan-barthold-jongkind-dutch-18191891_the-seine-at-bas-meudon.jpg' }, position: { x: 16, y: 2.0, z: -13, rotationY: -Math.PI / 2 }, sortValue: 10 },
    { slotNumber: 11, artwork: { id: 'art-111', title: '풀빌의 물결', artist: '모네', originPeriod: '근·현대', eraYear: 1882, descriptionDefault: '풀빌의 저류', imagePath: 'museum_cma_007_claude-monet-french-18401926_low-tide-at-pourville-near-dieppe-1882.jpg' }, position: { x: 16, y: 2.0, z: -10, rotationY: -Math.PI / 2 }, sortValue: 11 },
    { slotNumber: 12, artwork: { id: 'art-112', title: '플라타나무', artist: '반 고흐', originPeriod: '근·현대', eraYear: 1888, descriptionDefault: '플라타나무 길', imagePath: 'museum_cma_008_vincent-van-gogh-dutch-18531890_the-large-plane-trees-road-menders-at-saint-remy.jpg' }, position: { x: 16, y: 2.0, z: -7, rotationY: -Math.PI / 2 }, sortValue: 12 },
    // 동쪽 건물 - North Wall (3개)
    { slotNumber: 13, artwork: { id: 'art-113', title: '봄의 꽃', artist: '모네', originPeriod: '근·현대', eraYear: 1886, descriptionDefault: '봄날의 꽃다발', imagePath: 'museum_cma_013_claude-monet-french-18401926_spring-flowers.jpg' }, position: { x: 13, y: 2, z: -3, rotationY: 0 }, sortValue: 13 },
    { slotNumber: 14, artwork: { id: 'art-114', title: '수레와 풍경', artist: '반 고흐', originPeriod: '근·현대', eraYear: 1889, descriptionDefault: '수레와 풍경', imagePath: 'museum_cma_014_vincent-van-gogh-dutch-18531890_landscape-with-wheelbarrow.jpg' }, position: { x: 16, y: 2, z: -3, rotationY: 0 }, sortValue: 14 },
    { slotNumber: 15, artwork: { id: 'art-115', title: '두 사람', artist: '미상', originPeriod: '근·현대', eraYear: 1800, descriptionDefault: '두 사람을 묶는 모습', imagePath: 'museum_cma_015_anonymous_two-men-tying-a-bundle-recto.jpg' }, position: { x: 19, y: 2, z: -3, rotationY: 0 }, sortValue: 15 },
    // 동쪽 건물 - South Wall (3개)
    { slotNumber: 16, artwork: { id: 'art-116', title: '다섯 인물', artist: '미상', originPeriod: '근·현대', eraYear: 1800, descriptionDefault: '다섯 명의 인물 습작', imagePath: 'museum_cma_016_anonymous_five-figure-studies-verso.jpg' }, position: { x: 13, y: 2, z: 3, rotationY: Math.PI }, sortValue: 16 },
    { slotNumber: 17, artwork: { id: 'art-117', title: '크리스티', artist: '렘브란트', originPeriod: '근·현대', eraYear: 1648, descriptionDefault: '십자가의 크리스티', imagePath: 'museum_cma_017_rembrandt-van-rijn-dutch-16061669_christ-preaching-la-petite-tombe.jpg' }, position: { x: 16, y: 2, z: 3, rotationY: Math.PI }, sortValue: 17 },
    { slotNumber: 18, artwork: { id: 'art-118', title: '아덜린', artist: '반 고흐', originPeriod: '근·현대', eraYear: 1890, descriptionDefault: '아덜린의 초상', imagePath: 'museum_cma_018_vincent-van-gogh-dutch-18531890_adeline-ravoux.jpg' }, position: { x: 19, y: 2, z: 3, rotationY: Math.PI }, sortValue: 18 },
    // 서쪽 파빌리온 - North Wall (3개)
    { slotNumber: 19, artwork: { id: 'art-119', title: '포플라', artist: '반 고흐', originPeriod: '근·현대', eraYear: 1888, descriptionDefault: '알프스의 포플라', imagePath: 'museum_cma_019_vincent-van-gogh-dutch-18531890_two-poplars-in-the-alpilles-near-saint-remy.jpg' }, position: { x: -13, y: 1.5, z: 5, rotationY: 0 }, sortValue: 19 },
    { slotNumber: 20, artwork: { id: 'art-120', title: '빨간 수건의 여인', artist: '모네', originPeriod: '근·현대', eraYear: 1883, descriptionDefault: '빨간 수건의 여인', imagePath: 'museum_cma_020_claude-monet-french-18401926_the-red-kerchief.jpg' }, position: { x: -16, y: 1.5, z: 5, rotationY: 0 }, sortValue: 20 },
    { slotNumber: 21, artwork: { id: 'art-121', title: '십자가', artist: '렘브란트', originPeriod: '근·현대', eraYear: 1650, descriptionDefault: '십자가의 크리스티', imagePath: 'museum_cma_021_rembrandt-van-rijn-dutch-16061669_christ-crucified-between-the-two-thieves-the-three-crosses.jpg' }, position: { x: -19, y: 1.5, z: 5, rotationY: 0 }, sortValue: 21 },
    // 서쪽 파빌리온 - South Wall (3개)
    { slotNumber: 22, artwork: { id: 'art-122', title: '사와', artist: '렘브란트', originPeriod: '근·현대', eraYear: 1635, descriptionDefault: '사와의 초상', imagePath: 'museum_cma_022_rembrandt-van-rijn-dutch-16061669_rembrandt-and-his-wife-saskia.jpg' }, position: { x: -13, y: 1.5, z: 11, rotationY: Math.PI }, sortValue: 22 },
    { slotNumber: 23, artwork: { id: 'art-123', title: '르아브르', artist: '카테', originPeriod: '근·현대', eraYear: 1885, descriptionDefault: '르아브르의 운하', imagePath: 'museum_cma_023_siebe-johannes-ten-cate-dutch-18581908_the-grand-quai-of-le-havre.jpg' }, position: { x: -16, y: 1.5, z: 11, rotationY: Math.PI }, sortValue: 23 },
    { slotNumber: 24, artwork: { id: 'art-124', title: '카이아파', artist: '렘브란트', originPeriod: '근·현대', eraYear: 1660, descriptionDefault: '카이아파 앞의 크리스티', imagePath: 'museum_cma_024_rembrandt-van-rijn-dutch-16061669_christ-taken-before-caiaphas.jpg' }, position: { x: -19, y: 1.5, z: 11, rotationY: Math.PI }, sortValue: 24 },
    // 중앙 거울못 주변 - 공개 전시 (6개)
    { slotNumber: 25, artwork: { id: 'art-125', title: '수련', artist: '모네', originPeriod: '근·현대', eraYear: 1900, descriptionDefault: '수련의 연못', imagePath: 'museum_cma_025_claude-monet-french-18401926_water-lilies-agapanthus.jpg' }, position: { x: -4, y: 1.5, z: 4, rotationY: -0.5 }, sortValue: 25 },
    { slotNumber: 26, artwork: { id: 'art-126', title: '생 마메', artist: '시슬리', originPeriod: '근·현대', eraYear: 1883, descriptionDefault: '생 마메의 운하', imagePath: 'museum_cma_026_alfred-sisley-french-18401899_saint-mammes-loing-canal.jpg' }, position: { x: 4, y: 1.5, z: 4, rotationY: 0.5 }, sortValue: 26 },
    { slotNumber: 27, artwork: { id: 'art-127', title: '마르타', artist: '렘브란트', originPeriod: '근·현대', eraYear: 1655, descriptionDefault: '마르타와 마리아', imagePath: 'museum_cma_027_rembrandt-van-rijn-dutch-16061669_the-meeting-of-christ-with-martha-and-mary-after-the-death-of-lazarus.jpg' }, position: { x: -4, y: 1.5, z: -4, rotationY: 0.5 }, sortValue: 27 },
    { slotNumber: 28, artwork: { id: 'art-128', title: '염소 소녀', artist: '코로', originPeriod: '근·현대', eraYear: 1862, descriptionDefault: '개울가의 염소 소녀', imagePath: 'museum_cma_028_jean-baptiste-camille-corot-french-17961_lormes-goat-girl-sitting-beside-a-stream-in-a-forest.jpg' }, position: { x: 4, y: 1.5, z: -4, rotationY: -0.5 }, sortValue: 28 },
    { slotNumber: 29, artwork: { id: 'art-129', title: '기도', artist: '렘브란트', originPeriod: '근·현대', eraYear: 1635, descriptionDefault: '기도하는 노인', imagePath: 'museum_cma_029_rembrandt-van-rijn-dutch-16061669_an-elderly-man-in-prayer.jpg' }, position: { x: 0, y: 1.5, z: 6, rotationY: 0 }, sortValue: 29 },
    { slotNumber: 30, artwork: { id: 'art-130', title: '토비아스', artist: '렘브란트', originPeriod: '근·현대', eraYear: 1635, descriptionDefault: '아버지의 눈을 고치는 토비아스', imagePath: 'museum_cma_030_rembrandt-van-rijn-dutch-16061669_tobias-healing-his-fathers-blindness.jpg' }, position: { x: 0, y: 1.5, z: -6, rotationY: Math.PI }, sortValue: 30 },
  ],
};
