## CrowdSec

NPMpro에 내장된 CrowdSec bouncer를 CrowdSec 컨테이너에 연결합니다. 호스트로 들어오는 모든 요청은 CrowdSec Local API(LAPI)의 결정에 따라 검사되며, AppSec URL이 있으면 AppSec 규칙으로도 검사됩니다. 저장하면 nginx를 다시 로드해 설정이 즉시 적용되며 컨테이너는 재시작되지 않습니다.

NPMpro는 이 설정으로 `/data/crowdsec/crowdsec.conf`를 작성합니다. 이 파일을 직접 수정하면 덮어써집니다. 같은 폴더의 `ban.html`과 `captcha.html`은 직접 편집할 수 있습니다.

컨테이너에 설정한 변수는 UI보다 우선하며 해당 필드를 잠급니다: `CROWDSEC_ENABLED`, `CROWDSEC_LAPI_URL`, `CROWDSEC_API_KEY`, `CROWDSEC_APPSEC_URL`.

### 상태와 연결 테스트

nginx가 bouncer를 로드했는지와 NPMpro가 마지막으로 LAPI에 연결한 시각을 보여 줍니다. **연결 테스트**는 폼의 값을 확인합니다. 키(또는 TLS 클라이언트 인증서)로 LAPI에 결정 요청을 한 번 보내고, AppSec URL이 있으면 AppSec에도 한 번 요청합니다. 키 필드를 비워 두면 저장된 키를 사용합니다.

bouncer가 켜진 상태에서 저장하면 먼저 같은 테스트를 실행합니다. 실패하면 원인이 표시되며, **그래도 저장**을 누르면 그대로 저장됩니다. 예를 들어 CrowdSec이 아직 실행 중이 아닐 때 사용합니다.

AppSec이 실패하고 **AppSec에 연결할 수 없을 때**가 **요청 거부**이며 관리자 UI가 검사 대상이면 **그래도 저장**은 표시되지 않습니다. 그렇게 저장하면 관리자 UI에 접속할 수 없게 되기 때문입니다. **API 키** 또는 **AppSec URL**을 수정하거나, 실패 시 동작을 **요청 통과**로 바꾸거나, **관리자 UI를 CrowdSec에서 제외**를 켜세요.

### 연결

- **bouncer 사용**: 모든 요청을 검사합니다.
- **LAPI URL**: 예: `http://127.0.0.1:8080`.
- **API 키**: `docker exec crowdsec cscli bouncers add npmpro`로 받습니다. 암호화되어 저장되며 다시 표시되지 않습니다. **저장된 키 삭제**로 지울 수 있습니다.
- **TLS 클라이언트 인증서**: 키 대신 `/data/crowdsec/` 아래의 인증서 파일과 키 파일을 사용합니다. `https://` LAPI URL이 필요합니다. AppSec URL을 설정하면 TLS 클라이언트 인증서를 사용할 때도 **API 키** 필드가 표시되며 필수입니다. AppSec은 API 키로 인증하므로 키가 없으면 AppSec이 모든 요청을 거부합니다.
- **TLS 인증서 확인**: https LAPI 또는 AppSec URL의 인증서를 확인합니다.

### 차단

- **모드**: 라이브는 클라이언트 IP마다 LAPI에 물어보고 지정한 초만큼 응답을 캐시하며, 스트림은 지정한 간격으로 모든 결정을 내려받습니다.
- **차단에 대한 응답**: 차단 페이지(선택 상태 코드 포함, 기본 403), 리디렉션, 또는 페이지 없는 상태 코드.
- **대체 조치**와 **결정 유형**: bouncer가 적용할 수 없는 결정을 어떻게 처리할지, 그리고 어떤 유형을 적용할지.
- **관리자 UI를 CrowdSec에서 제외**: 관리자 UI로 가는 요청은 bouncer와 AppSec을 건너뜁니다. AppSec을 거부 방식으로 쓰기 전에 켜 두면 CrowdSec 장애로 접속할 수 없게 되는 일이 없습니다.

### 캡차

제공업체(reCAPTCHA, hCaptcha, Cloudflare Turnstile), 사이트 키와 비밀 키, 해결한 캡차의 유효 시간. 캡차 유형 결정에 사용됩니다.

### AppSec

- **AppSec URL**: 예: `http://127.0.0.1:7422`. 비우면 AppSec이 꺼집니다.
- **AppSec에 연결할 수 없을 때**: AppSec을 사용할 수 없는 동안 거부는 검사 대상의 모든 요청을 차단하고, 통과는 검사 없이 그대로 보냅니다.

### 고급

LAPI 요청 제한 시간, 시나리오 필터, 제외할 경로, 내부 요청, AppSec 제한 시간과 옵션, 그리고 **미리보기**가 있는 차단 페이지와 캡차 페이지 파일.

### 접속할 수 없나요?

CrowdSec을 다시 시작하거나 컨테이너에 `CROWDSEC_ENABLED=false`를 설정하고 다시 만든 다음, 여기서 설정을 고치세요.

자세한 내용은 위키를 참조하세요: CrowdSec.
