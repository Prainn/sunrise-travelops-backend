# Include only in the API server for the environment serving document links.
# The one-file bearer token is embedded in the path to keep the file extension last.
location ~* ^/api/whatsapp/document-transfer(?:/|$) {
    access_log off;
    error_log /dev/null crit;
    proxy_pass http://$api_upstream;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Request-ID $request_id;
}
