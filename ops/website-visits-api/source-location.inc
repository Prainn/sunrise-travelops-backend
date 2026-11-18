# Candidate for the production HTTPS server ONLY, after approval.
# $api_upstream must already resolve to the production API, never old dev.
location ~ ^/api/internal/website-visits(?:/|$) {
    allow 172.29.23.198;
    deny all;
    limit_except GET { deny all; }
    access_log off;
    proxy_pass http://$api_upstream;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Request-ID $request_id;
    proxy_buffering off;
    proxy_cache off;
    proxy_connect_timeout 5s;
    proxy_read_timeout 30s;
}
