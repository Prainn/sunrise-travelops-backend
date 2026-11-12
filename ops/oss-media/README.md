# Dev 媒体存储与发送中继

只安装开发环境。API 容器不访问 IMDS、不持有 AccessKey；实例角色仍为 sunrise-whatsapp-runtime。

- sunrise-oss-dev：组 sunrise-oss-dev（GID 2000），socket `/run/sunrise-oss-dev/oss.sock`，仅接受 `dev/whatsapp/<uuid>/original.*|thumbnail.webp|send.jpg` 的 put/delete，单次最多5MiB、并发2。
- sunrise-whatsapp-send-dev：独立于现行共享/生产 sender，配置 `/etc/sunrise-whatsapp-send-dev/config.json`，socket `/run/sunrise-whatsapp-send-dev/send.sock`。复制既有账号配置并补 `socket`、`mediaOrigin=https://media.sunrisevacation.cn`，image链接只允许本域名dev前缀；不改生产sender。应用 SEND_ENABLED=false 仍然禁止发送。
- 私有OSS写策略见 dev-write-policy.json；CDN读取策略见 cdn-read-policy.json，当前均限dev路径。生产启用另行审核和安装，不能直接复制dev配置。
- OSS原图/缩略图/发送副本 Cache-Control 300秒，CDN路径规则同为300秒。对象删除不等同缓存即时刷新。

使用前端已安装 Vite 的 rolldown 依赖分别将后端 ops/oss-media/main.cjs、ops/whatsapp-send/main.cjs 打包为单个CJS，platform=node。ali-oss的proxy-agent为可选代理依赖，服务不配置HTTP_PROXY/HTTPS_PROXY。不要把凭据放入构建物或仓库。

宿主安装须持 `/opt/sunrise-ci/build.lock`，使用现有 Node `/opt/sunrise-ci/node/bin/node`：bundle分别放入 `/opt/sunrise-oss-dev/relay.cjs` 和 `/opt/sunrise-whatsapp-send-dev/relay.cjs`，unit使用本目录模板；配置root:root 0600，运行目录root:sunrise-oss-dev 0750、socket0660。写入配置 `{environment:"dev",bucket:"sunrise-travelops-media",roleName:"sunrise-whatsapp-runtime",socket:"/run/sunrise-oss-dev/oss.sock"}`。

将compose.dev.yml单独安装至 `/opt/sunrise-travelops-dev`；它保留dev数据库配置，并覆盖API挂载只使用dev发送与OSS sockets。宿主 `/run/sunrise-whatsapp-send-dev` 映射至容器固定的 `/run/sunrise-whatsapp-send`，以满足应用的socket路径白名单；容器不能挂载生产共享目录。`oss-media.env`沿用示例；CDN/RAM权限未完成时OSS_MEDIA_ENABLED=false。`docker compose ... config --quiet`核验后，应用镜像通过现行Actions部署。服务安装不是应用部署，不允许替代Actions构建发布。

核验：服务active、发送/OSS socket权限、prod路径写入返回400（无云写入）；在获批云授权后以随机dev测试对象验证PUT/CDN GET/DELETE，不向WhatsApp发消息。运行时配置变更重建dev API须继续持共享锁并固定当前已验证image。
