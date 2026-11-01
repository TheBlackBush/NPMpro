## nginx

모든 호스트에 적용되는 nginx 자체의 설정입니다. 실행할 워커 수, TLS 규칙, 선택적 모듈을 설정합니다. 저장하면 설정을 테스트하고 nginx를 리로드합니다. 테스트에 실패한 설정은 적용되지 않습니다.

컨테이너에 설정된 변수는 UI보다 우선하며 해당 필드를 잠급니다(필드에 "NGINX_WORKER_PROCESSES(으)로 설정됨"과 같은 잠금 배지가 표시됩니다). 컨테이너에 설정되지 않은 항목은 UI에서 설정하세요. 여기의 모든 설정은 저장할 때 실행되는 nginx 리로드 후에 적용됩니다.

### 워커

- **워커 프로세스**: "자동(CPU 스레드당 하나)" 또는 컨테이너에서 보이는 CPU 스레드 수 이하의 숫자입니다. 기본값: 스레드당 하나, 최대 4. 변수: `NGINX_WORKER_PROCESSES`.
- **워커당 연결 수**: 각 워커가 동시에 처리하는 열린 연결 수로 64~65535입니다. 기본값: 512. 변수: `NGINX_WORKER_CONNECTIONS`.
- **워커 종료 시간 제한**: 리로드 후 이전 워커가 연결을 유지하는 시간입니다. `30s`, `10m`, `1h` 같은 nginx 시간 값이며 `0`은 제한 없음을 뜻합니다. 기본값: `1h`. 변수: `NGINX_WORKER_SHUTDOWN_TIMEOUT`.

### 로깅

- **파일 없음 오류 기록**: 없는 파일을 요청할 때마다 오류 로그를 한 줄 기록합니다. 기본값: 꺼짐. 변수: `NGINX_LOG_NOT_FOUND`.

### 모든 호스트의 TLS

TLS 1.2나 NIST P 곡선을 끄면 오래된 브라우저와 클라이언트가 차단됩니다. TLS 1.3은 항상 켜져 있습니다.

- **TLS 1.2 허용**: 기본값은 켜짐입니다. 변수: `NGINX_DISABLE_TLS12`(반전: `true`이면 TLS 1.2가 꺼짐).
- **양자 내성 키 교환만 사용**: X25519MLKEM768만 허용하며 최신 클라이언트가 필요합니다. 켜져 있는 동안 TLS 1.2와 NIST P 곡선이 꺼지고 잠깁니다. 기본값: 꺼짐. 변수: `NGINX_FORCE_X25519MLKEM768`.
- **NIST P 곡선 허용**: X25519 외에 키 교환에 secp521r1, secp384r1, prime256v1을 허용합니다. 기본값: 켜짐. 변수: `NGINX_TRUST_SECPR1`.
- **RSA PKCS#1 서명 허용**: RSA-PSS를 사용할 수 없는 오래된 클라이언트용입니다. 기본값: 꺼짐. 변수: `NGINX_TRUST_RSA_PKCS1`.

### 모듈

모두 기본값은 꺼짐입니다. 직접 만든 사용자 지정 설정에서 필요할 때만 모듈을 켜세요. 사용자 지정 설정이 아직 사용 중인 모듈을 끄면 nginx 테스트가 실패합니다.

- **njs (JavaScript)**: `js_*` 지시문. 변수: `NGINX_LOAD_NJS_MODULE`.
- **LDAP 인증**: `auth_ldap` 지시문. 변수: `NGINX_LOAD_LDAP_MODULE`.
- **NTLM 업스트림**: 업스트림 블록의 `ntlm`. 변수: `NGINX_LOAD_NTLM_MODULE`.
- **가상 호스트 트래픽 상태**: `vhost_traffic_status_*` 지시문. 변수: `NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE`.

자세한 내용은 위키를 참조하세요: Configuration.
