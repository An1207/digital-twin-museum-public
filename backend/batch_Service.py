from typing import List

# --- 1단계: 거리 행렬 (Lookup Tables) 사전화 ---
# 거리가 0.0이면 완전 일치, 1.0이면 완전 상극을 의미합니다.
THEMA_DISTANCE = {
    "자연": {"자연": 0.0, "민속": 0.4, "도시": 0.7, "전쟁": 1.0},
    "민속": {"자연": 0.4, "민속": 0.0, "도시": 0.5, "전쟁": 0.8},
    "도시": {"자연": 0.7, "민속": 0.5, "도시": 0.0, "전쟁": 0.3},
    "전쟁": {"자연": 1.0, "민속": 0.8, "도시": 0.3, "전쟁": 0.0},
}

EMOTION_DISTANCE = {
    "평온": {"평온": 0.0, "슬픔": 0.3, "경이": 0.6, "역동": 1.0},
    "슬픔": {"평온": 0.3, "슬픔": 0.0, "경이": 0.4, "역동": 0.8},
    "경이": {"평온": 0.6, "슬픔": 0.4, "경이": 0.0, "역동": 0.3},
    "역동": {"평온": 1.0, "슬픔": 0.8, "경이": 0.3, "역동": 0.0},
}

def _get_dist(matrix: dict, key1: str, key2: str) -> float:
    """안전한 행렬 거리 조회기. 매칭 값이 없으면 최대 거리(1.0)를 반환"""
    if not key1 or not key2:
        return 1.0
    # 문자열 앞뒤 공백을 제거하고 조회하여 매칭 오류 방지
    return matrix.get(key1.strip(), {}).get(key2.strip(), 1.0)


# --- 2단계: 메인 알고리즘 ---
def run_curation_algorithm(user_request, artworks_list) -> List[int]:
    """
    사용자의 단일 선택값(주테마, 주감정, 시대)과 DB 작품 리스트를 받아
    절대 가중치 및 부속성 보너스를 합산하여 정렬 후 ID 리스트 반환
    """
    # 사용자의 기준값
    user_thema = user_request.thema.strip()
    user_emotion = user_request.emotion.strip()
    user_era = user_request.era.strip()

    scored_artworks = []
    
    for art in artworks_list:
        score = 0.0
        
        # DB 데이터 정제 (안전한 속성 접근)
        art_main_thema = getattr(art, 'main_thema', '').strip()
        art_main_emotion = getattr(art, 'main_emotion', '').strip()
        art_era = getattr(art, 'era', '').strip()
        
        # 1. 주지표 절대 가중치 매칭 (조건 3개 일치 시 무조건 최상위 0.81점 보장)
        if art_main_thema == user_thema:     score += 0.500
        if art_main_emotion == user_emotion: score += 0.300
        if art_era == user_era:              score += 0.010
        
        # 2. 부테마 발굴 보너스 (최대 +0.100)
        art_sub_thema = getattr(art, 'sub_thema', None)
        if art_sub_thema:
            art_sub_thema = art_sub_thema.strip()
            dist = _get_dist(THEMA_DISTANCE, user_thema, art_sub_thema)
            score += 0.100 * (1.0 - dist)
            
        # 3. 부감정 발굴 보너스 (최대 +0.050)
        art_sub_emotion = getattr(art, 'sub_emotion', None)
        if art_sub_emotion:
            art_sub_emotion = art_sub_emotion.strip()
            dist = _get_dist(EMOTION_DISTANCE, user_emotion, art_sub_emotion)
            score += 0.050 * (1.0 - dist)
            
        # 정렬을 위해 계산된 값들을 객체에 임시 저장
        art.tmp_final_score = round(score, 4)
        # 0점 동점자를 완벽하게 가르기 위한 주감정 거리 백업 (사용자 감정 <-> 작품 주감정)
        art.tmp_emotion_dist = _get_dist(EMOTION_DISTANCE, user_emotion, art_main_emotion)
        
        scored_artworks.append(art)

    # 3. 다중 조건 정렬 (Sorting Hierarchy)
    # 1순위: 계산된 최종 점수 내림차순 (-) -> 가중치가 높을수록 1등
    # 2순위: 주감정 거리 오름차순 -> 점수가 0점이어도 파동이 비슷한 감정 우선
    # 3순위: 시대 연도(era_year) 오름차순 -> 역사적 순서 정렬
    scored_artworks.sort(key=lambda x: (
        -x.tmp_final_score,
        x.tmp_emotion_dist,
        getattr(x, 'era_year', 9999) # 결측치 대비 안전망
    ))

    # 디버깅 및 서버 로그 확인용 출력
    for art in scored_artworks:
        art_title = getattr(art, 'title', '제목없음')
        print(f"ID: {art.id} | 제목: {art_title} | 총점: {art.tmp_final_score} | 감정거리: {art.tmp_emotion_dist}")

    # 4. 최종적으로 정렬된 작품들의 ID 리스트만 추출하여 반환
    return [art.id for art in scored_artworks]