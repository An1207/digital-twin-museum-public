# Asset Management

3D 모델(`.glb`/`.gltf`), 사용자 업로드 이미지, 배포 라이선스가 확인되지
않은 글꼴, 생성된 음성 파일은 이 공개
스냅샷에 포함하지 않습니다. 배포자는 사용 권한을 확인한 자산만 별도
스토리지에 보관하고 로컬 개발 시 필요한 경로에 직접 배치해야 합니다.

## 필요한 자산

| 로컬 경로 | 내용 | 파일 수 |
|-----------|------|---------|
| `backend/local_assets/` | 3D GLB 모델 (작품별 `framed_artwork.glb`) | 공개본에서 제외 |
| `frontend/public/models/` | 전시실/기본 3D 모델 | 별도 준비 |
| `frontend/public/fonts/` | 배포 라이선스를 확인한 웹 글꼴 | 선택 사항 |
| `database/images/artworks/` | 사용 권한을 확인한 작품 이미지 | 별도 준비 |

## 자산 목록 파일 (manifest)

공개 데이터 출처를 확인하려면
[이미지 manifest](database/images/ASSET_MANIFEST.json)를 참조하세요. 이 목록은
MET/CMA 공개 데이터 출처만 남긴 참고 자료이며, 파일 자체나 재배포 권리를
보증하지 않습니다. GLB manifest와 사용자 업로드 기록은 공개본에서 제외했습니다.

## 자산 없이 앱 기동

자산 없이도 앱은 기동됩니다. DB 스키마는 첫 실행 시 자동 생성됩니다.
데모 데이터가 필요하면 `LOAD_DEMO_DATA=true`를 명시해야 합니다.

- GLB 파일 없음 → 3D 뷰어 로드 실패 (나머지 기능 정상)
- 이미지 없음 → 썸네일 미표시 (나머지 기능 정상)

## 환경변수로 경로 변경

자산을 다른 경로에 두거나 외부 스토리지 마운트 경로를 지정할 때:

```env
ASSET_ROOT=/path/to/local_assets
IMAGE_ROOT=/path/to/images
```

자세한 내용은 [backend/runtime_config.py](backend/runtime_config.py)를 참조하세요.

## 자산 소스 정보

| 소스 | 설명 |
|------|------|
| `met` | The Metropolitan Museum of Art Open Access |
| `cma` | Cleveland Museum of Art Open Access |

각 공급자의 최신 라이선스와 작품별 권리 상태를 배포 전에 다시 확인하세요.
