## フォワード認証

フォワード認証は、プロキシホストの前にログインやボットチェックを置きます。リクエストごとに、nginx はまず認証サービスに、訪問者を通してよいかを問い合わせます。NPMpro には Anubis、Tinyauth、OAuth2 Proxy、VoidAuth、Authelia、Authentik が組み込まれています。プロバイダーは、独自のコンテナで実行します。

このページでは、各プロバイダーのデフォルトのアドレス(アップストリーム)を設定します。プロキシホストでは、詳細タブのオプションにある **Auth Request**(またはカスタムロケーション)でチェックをオンにします。

コンテナに設定された変数は UI より優先され、そのフィールドをロックします(フィールドには「AUTH_REQUEST_AUTHELIA_UPSTREAM で設定済み」のようなロックバッジが表示されます)。コンテナで設定されていない項目は UI で設定してください。ここでの設定はすべて、保存時に実行される nginx のリロード後に適用されます。nginx のテストに失敗した場合は、何も保存されません。

### デフォルトのアップストリーム

- **Anubis アップストリーム**、**Tinyauth アップストリーム**、**OAuth2 Proxy アップストリーム**、**VoidAuth アップストリーム**、**Authelia アップストリーム**、**Authentik アップストリーム**: 独自のアップストリームを持たない、そのプロバイダーのプロキシホストで使われます。ホスト自身の値が優先されます。デフォルト: 空(なし)。変数: `AUTH_REQUEST_ANUBIS_UPSTREAM`、`AUTH_REQUEST_TINYAUTH_UPSTREAM`、`AUTH_REQUEST_OAUTH2PROXY_UPSTREAM`、`AUTH_REQUEST_VOIDAUTH_UPSTREAM`、`AUTH_REQUEST_AUTHELIA_UPSTREAM`、`AUTH_REQUEST_AUTHENTIK_UPSTREAM`。

形式: `scheme://host:port`(例: `http://127.0.0.1:9091`)、または名前が `cu_` で始まる独自の nginx アップストリームブロック用の `scheme://cu_name`。`http` または `https` を使い、ポートは必須で、IPv6 アドレスは角括弧で囲みます。パス、スペース、`; { } # " ' $ \` のいずれも使えません。

独自のアップストリームを持たずにそのプロバイダーを使うプロキシホストがある間は、デフォルトを空にできません。メッセージにそれらのホストが表示されます。

どこにもアップストリームがないプロバイダーを使うホストは、「設定エラー」になります。

### Anubis

- **カスタム Anubis 画像**: Anubis のチャレンジページに、独自の `happy.webp`、`reject.webp`、`pensive.webp` を表示します。デフォルト: 3 つのファイルがすべて存在し空でない場合はオン、それ以外はオフ。変数: `AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES`。画像は、データフォルダの `public/anubis` に置きます。

詳しくは wiki を参照してください: Forward-Authentication。
