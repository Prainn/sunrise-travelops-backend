# Include inside dev API server blocks only. API validates the precise file size.
location ~* ^/api/whatsapp/conversations/[0-9a-f-]{36}/documents/?$ {
    client_max_body_size 21m;
    proxy_pass http://$api_upstream;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Request-ID $request_id;
}
