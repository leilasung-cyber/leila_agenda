# 집 PC 작업 안내 (Leila Portal 배포 이어하기)

이 폴더는 회사 PC에서 준비를 마친 상태로 USB를 통해 집 PC로 옮겨진 것입니다.
회사망이 외부 업로드를 차단해서(사내 DLP 정책) GitHub 업로드만 집 네트워크에서 진행합니다.

## 현재 상태 (회사 PC에서 완료됨)
- git 저장소 준비 완료: 12개 파일이 `main` 브랜치에 커밋됨 (커밋 `913e78b` "Initial commit: Leila Portal PWA")
- remote 설정 완료: `https://github.com/leilasung-cyber/leila_agenda` (HTTPS, 원격 URL에 토큰 내장)
- `vercel.json` 추가됨 (정적 사이트 배포 설정)
- GitHub 원격에는 임시 `.init` 파일만 있음 → 아래 push가 `--force`로 덮어씀

## 집 PC에서 할 일

### 1) GitHub에 업로드
집 인터넷(회사 프록시 없음)에 연결된 상태에서, 이 폴더에서 아래 중 하나 실행:

**방법 A — 배치 파일 더블클릭 (제일 쉬움)**
```
push_from_home.bat
```

**방법 B — 직접 명령**
```powershell
git push -u origin main --force
```

`Everything up-to-date`가 아니라 브랜치가 올라갔다는 메시지가 나오면 성공.
확인: https://github.com/leilasung-cyber/leila_agenda 에 파일 12개가 보이면 됨.

> 참고: 원격 URL에 이미 인증 토큰이 들어 있어 로그인 창이 안 뜰 수 있습니다.
> 만약 토큰이 만료/삭제되어 인증을 물으면, GitHub 사용자명 + Personal Access Token(비밀번호 자리)을 입력하세요.

### 2) Vercel 배포 (이 단계는 회사망에서도 됨 — 파일 업로드 없이 GitHub에서 가져오기 때문)
1. https://vercel.com → GitHub 계정으로 로그인
2. Add New → Project → `leila_agenda` 저장소 Import
3. 설정 그대로 두고 Deploy
4. 나온 주소(예: https://leila-agenda.vercel.app)를 PC/폰에서 열기
5. 폰에서는 브라우저 공유 → "홈 화면에 추가"로 앱처럼 설치 (PWA)

## 끝난 뒤 보안 정리 (중요)
배포가 끝나면 https://github.com/settings/tokens 에서 이 저장소에 쓰던 토큰을 **Delete(revoke)** 하세요.
(원격 URL에 박힌 토큰이라 노출 위험이 있고, Vercel 연결 후에는 필요 없습니다.)
그 후 remote를 토큰 없는 주소로 정리하려면:
```powershell
git remote set-url origin https://github.com/leilasung-cyber/leila_agenda.git
```
(이후 push 때는 GitHub 로그인 창에서 새 토큰으로 인증)
