## 인증서 및 TLS

ACME 서버(`ACME_SERVER`로 다른 서버를 지정하지 않으면 Let's Encrypt)에 요청하는 인증서의 기본값, 스테이플링과 갱신 방식, 알 수 없는 호스트에 어떤 인증서로 응답할지를 설정합니다. 이것은 설정 섹션이며 인증서 목록 페이지가 아닙니다.

컨테이너에 설정된 변수는 UI보다 우선하며 해당 필드를 잠급니다(필드에 "ACME_KEY_TYPE(으)로 설정됨"과 같은 잠금 배지가 표시됩니다). 일부 필드는 다른 필드를 따릅니다. ECDSA 곡선인 `ACME_KEY_SIZE`만 단독으로 설정되어 있으면 키 유형은 ECDSA로 유지되며, Must-Staple은 OCSP 스테이플링을 켜진 상태로 유지합니다. 컨테이너에 설정되지 않은 항목은 UI에서 설정하세요.

### 인증서 요청

이 설정은 다음 인증서 요청부터 적용됩니다.

- **키 유형**: `ECDSA`(기본값, 권장: 키가 작고 핸드셰이크가 빠름) 또는 ECDSA를 사용할 수 없는 클라이언트를 위한 `RSA`. 변수: `ACME_KEY_TYPE`.
- **키 크기**: ECDSA에서는 곡선(`secp256r1`, `secp384r1`, `secp521r1`, 기본값 `secp384r1`), RSA에서는 비트 수(`2048`, `3072`, `4096`, 기본값 `4096`). 변수: `ACME_KEY_SIZE`.
- **ACME 프로필**: 서버에 요청하는 프로필이며, 저장할 때 서버에서 확인됩니다. 비워 두면 서버 기본값을 사용합니다. Let's Encrypt의 기본값은 `shortlived`입니다. Common Name이 필요한 클라이언트는 `shortlived` 및 `tlsserver` 인증서에서 작동하지 않습니다. 변수: `ACME_PROFILE`(비우려면 `none`).
- **OCSP Must-Staple**: 새 인증서에 must-staple을 표시하고 OCSP 스테이플링을 켜진 상태로 유지합니다. 이를 지원하는 CA(ZeroSSL)에서만 사용할 수 있으며, Let's Encrypt는 이런 요청을 거부합니다. 기본값: Google Trust Services와 ZeroSSL에서는 켜짐, 그 외에는 꺼짐. 변수: `ACME_MUST_STAPLE`.
- **ACME 서버 인증서 검증**: 기본값은 켜짐입니다. 자체 서명 인증서를 사용하는 사설 ACME 서버일 때만 끄세요. 변수: `ACME_SERVER_TLS_VERIFY`.

### 스테이플링

두 설정 모두 저장할 때 실행되는 nginx 리로드 후에 적용되며, 둘 다 TLS 인증서 압축을 끕니다.

- **ACME 인증서의 OCSP 스테이플링**: CA가 OCSP를 제공하는 경우, ACME 서버의 인증서와 함께 OCSP 응답을 보냅니다. 기본값: Google Trust Services와 ZeroSSL에서는 켜짐, 그 외에는 꺼짐. 변수: `ACME_OCSP_STAPLING`.
- **사용자 지정 인증서의 OCSP 스테이플링**: 업로드한 인증서에 대한 동일한 설정입니다. 기본값: 꺼짐. 변수: `CUSTOM_OCSP_STAPLING`.

### 기본 인증서

- **알 수 없는 호스트 및 웹 UI용 인증서**: NPMpro에 해당 호스트가 없는 호스트 이름과 웹 UI 포트에서 제공됩니다. 기본값: 내장(생성된 임시 인증서). 변수: `DEFAULT_CERT_ID`(인증서 ID, `0`은 내장). 저장할 때 실행되는 nginx 리로드 후에 적용됩니다.

### 갱신

- **갱신 확인 주기**: 확인 사이의 간격으로 1~499시간입니다. 인증서는 갱신 시기가 되었을 때만 갱신됩니다. 기본값: 3. 변수: `CERTBOT_RUN_INTERVAL`. 즉시 적용됩니다.

### ECH

- **ECH 키 교체 주기**: ECH 스크립트(`/data/tls/ech/cron.sh`)를 실행하는 간격으로 1~24시간입니다. 스크립트가 비어 있지 않을 때만 사용됩니다. 기본값: 1. 변수: `ECH_ROTATION_INTERVAL`. 즉시 적용됩니다.

자세한 내용은 위키를 참조하세요: Security.
