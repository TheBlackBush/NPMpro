## 포워드 인증

포워드 인증은 프록시 호스트 앞에 로그인 또는 봇 검사를 둡니다. 요청마다 nginx가 먼저 인증 서비스에 방문자를 통과시켜도 되는지 묻습니다. NPMpro에는 Anubis, Tinyauth, OAuth2 Proxy, VoidAuth, Authelia, Authentik이 내장되어 있습니다. 공급자는 자체 컨테이너에서 실행합니다.

이 페이지는 각 공급자의 기본 주소(업스트림)를 설정합니다. 프록시 호스트는 세부 정보 탭의 옵션 아래에 있는 **Auth Request**(또는 사용자 지정 위치)로 검사를 켭니다.

컨테이너에 설정된 변수는 UI보다 우선하며 해당 필드를 잠급니다(필드에 "AUTH_REQUEST_AUTHELIA_UPSTREAM(으)로 설정됨"과 같은 잠금 배지가 표시됩니다). 컨테이너에 설정되지 않은 항목은 UI에서 설정하세요. 여기의 모든 설정은 저장할 때 실행되는 nginx 리로드 후에 적용됩니다. nginx 테스트가 실패하면 아무것도 저장되지 않습니다.

### 기본 업스트림

- **Anubis 업스트림**, **Tinyauth 업스트림**, **OAuth2 Proxy 업스트림**, **VoidAuth 업스트림**, **Authelia 업스트림**, **Authentik 업스트림**: 자체 업스트림이 없는 해당 공급자의 프록시 호스트가 사용합니다. 호스트 자체의 값이 우선합니다. 기본값: 비어 있음(없음). 변수: `AUTH_REQUEST_ANUBIS_UPSTREAM`, `AUTH_REQUEST_TINYAUTH_UPSTREAM`, `AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`, `AUTH_REQUEST_VOIDAUTH_UPSTREAM`, `AUTH_REQUEST_AUTHELIA_UPSTREAM`, `AUTH_REQUEST_AUTHENTIK_UPSTREAM`.

형식: `scheme://host:port`(예: `http://127.0.0.1:9091`) 또는 이름이 `cu_`로 시작하는 직접 만든 nginx 업스트림 블록을 가리키는 `scheme://cu_name`. `http` 또는 `https`를 사용하고, 포트는 필수이며, IPv6 주소는 대괄호 안에 넣습니다. 경로, 공백, `; { } # " ' $ \`는 사용할 수 없습니다.

자체 업스트림 없이 해당 공급자를 사용하는 프록시 호스트가 있는 동안에는 기본값을 비울 수 없습니다. 메시지에 해당 호스트가 나열됩니다.

어디에도 업스트림이 없는 공급자를 사용하는 호스트는 "설정 오류"가 됩니다.

### Anubis

- **사용자 지정 Anubis 이미지**: Anubis 챌린지 페이지에 직접 만든 `happy.webp`, `reject.webp`, `pensive.webp`를 표시합니다. 기본값: 세 파일이 모두 있고 비어 있지 않으면 켜짐, 그렇지 않으면 꺼짐. 변수: `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES`. 이미지는 데이터 폴더의 `public/anubis`에 넣습니다.

자세한 내용은 위키를 참조하세요: Forward-Authentication.
