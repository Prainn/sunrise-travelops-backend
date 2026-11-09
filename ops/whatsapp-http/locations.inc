# Include inside the chosen API's TLS server, not both dev and prod.
# Match Express's case-insensitive and optional trailing-slash routing as well.
# Existing /api/ location must not use ^~, which would bypass regex selection.
location ~* ^/api/whatsapp/ingress/(inbound|status)/?$ {
    if ($whatsapp_callback_allowed = 0) { return 403; }
    if ($request_method != POST) { return 405; }

    client_max_body_size 1m;
    access_log /var/log/nginx/access.log whatsapp_callback;

    proxy_pass http://$api_upstream;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $realip_remote_addr;
    proxy_set_header X-Forwarded-For $realip_remote_addr;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Request-ID $request_id;
    proxy_set_header Connection "";
    # The included file MUST replace the caller's Authorization header.
    include /etc/nginx/conf.d/whatsapp/http-token.inc;

    proxy_connect_timeout 1s;
    proxy_send_timeout 2s;
    proxy_read_timeout 2s;
    proxy_next_upstream off;
    proxy_cache off;
    proxy_intercept_errors off;
    # Never synthesize success; the application acknowledges after persistence.
}
