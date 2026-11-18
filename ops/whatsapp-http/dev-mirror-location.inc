# Internal subrequest in the production ingress. The main callback is handled by production.
location = /_sunrise_whatsapp_dev_mirror {
    internal;
    set $whatsapp_dev_mirror_upstream sunrise-prod-chatapp-filter:8080;
    proxy_pass http://$whatsapp_dev_mirror_upstream$request_uri;
    proxy_pass_request_headers off;
    proxy_set_header Content-Type application/json;
    include /etc/nginx/conf.d/whatsapp/http-token-dev-mirror.inc;
    proxy_connect_timeout 250ms;
    proxy_send_timeout 1s;
    proxy_read_timeout 2s;
    proxy_next_upstream off;
    access_log off;
}
