# Ubuntu 部署与迁移

Miweb 由前端、Node.js API 和 Chromium 渲染器组成。使用仓库中的 Dockerfile 与 Compose 在 Ubuntu 运行，Nginx 提供 HTTPS。目标是单实例、受控用户或团队使用；访问密钥由同一个服务的使用者共享。

## 部署前准备

- Ubuntu 22.04/24.04 LTS，Docker Engine 和 Compose v2。建议从 2 核、4 GB 内存开始；这不是并发容量承诺，需按实际页面大小观察资源使用。
- 域名解析到服务器，云防火墙允许 TCP 80/443。Docker 服务端口只绑定 `127.0.0.1`，不需要向公网开放 4173。
- 服务器可访问目标网站、npm registry、Docker registry 和 Playwright 浏览器下载站。构建时下载 Chromium，运行时不需要在线安装浏览器。
- 按 [Docker 官方 Ubuntu 安装说明](https://docs.docker.com/engine/install/ubuntu/) 安装 Engine 与 Compose 插件，执行 `sudo docker version`、`sudo docker compose version` 确认。不要在已有业务服务器上盲目卸载其容器运行时。

Ubuntu 服务器上的 `localhost` 指服务器自身，不是访问者的电脑。公开模式固定 `LOCAL_ACCESS=0`：用户输入公开网址，或通过“选择项目文件夹”上传 HTML / Vite React / Vue 项目。远程服务不能通过 `D:\projects\site` 读取用户电脑；未公开的本地开发服务可在电脑上运行 Miweb 后使用。不要为了读取客户端项目而在公开服务器开启本地访问。

## 1. 迁移项目

把源代码复制到服务器目录，例如 `/opt/miweb`。需要 `package.json`、`package-lock.json`、`Dockerfile`、`compose.yaml`、前端源码、`server/`、`examples/` 和构建配置。保留完整仓库最方便；不要上传 `node_modules/`、`.env`、`deploy/production.env`、`*.log` 运行日志、本地测试输出和私有项目。

可在 Windows 仓库根目录打包（归档放在系统临时目录，避免把归档自己打进去）：

```powershell
$miwebArchive = Join-Path $env:TEMP 'miweb-src.tar.gz'
tar -czf $miwebArchive --exclude=.git --exclude=node_modules --exclude=dist --exclude=.env --exclude=.env.* --exclude=deploy/production.env --exclude='*.log' --exclude=test-results --exclude=.miweb --exclude=playwright-report .
scp $miwebArchive deploy@YOUR_SERVER:/tmp/miweb-src.tar.gz
```

在 Ubuntu 上，用现有 SSH 用户替换 `deploy`，把归档解压到为本项目准备的空目录：

```bash
sudo install -d -o "$USER" -g "$(id -gn)" /opt/miweb
cd /opt/miweb
tar -xzf /tmp/miweb-src.tar.gz
install -m 600 deploy/production.env.example deploy/production.env
```

## 2. 设置密钥与域名

编辑 `deploy/production.env`：

```dotenv
MIWEB_ACCESS_KEY=填入随机密钥
PUBLIC_ORIGIN=https://tune.example.com
MIWEB_IMAGE=miweb:local
MIWEB_PORT=4173
SESSION_TTL_MINUTES=120
```

用 `openssl rand -hex 32` 生成密钥，粘贴到 `MIWEB_ACCESS_KEY`。域名必须与用户最终打开的网站一致，不带子路径。文件保持权限 `600`，不要提交到版本库或发送给不需要访问服务的人。客户端首次使用会要求输入服务密钥。

Compose 会读取显式传入的 `--env-file`，服务本身不会自动读取 `.env`。缺少密钥或 `PUBLIC_ORIGIN` 时 Compose 会拒绝启动；这是 [Compose 必填变量语法](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/) 的预期行为。

```bash
sudo docker compose --env-file deploy/production.env config --quiet
sudo docker compose --env-file deploy/production.env up -d --build --wait --wait-timeout 180
sudo docker compose --env-file deploy/production.env ps
curl --fail http://127.0.0.1:4173/api/health
```

健康接口应返回 `ok: true`、`localAccess: false`、`requiresKey: true`。健康接口只检查服务，不代表目标网页一定可以成功渲染。不要把 `docker compose config` 的完整输出发到公开日志，因为它包含密钥。

Compose 已设置非 root 用户、只读根文件系统、`/tmp` 临时空间、1 GB `/dev/shm`、2 GB 内存与 2 CPU 限制、PID 限额、重启策略和日志轮转。Node 和 Chromium 的数据只在单个容器会话中；文件上传和构建缓存位于临时目录。Chromium 的系统 sandbox 开关仍使用应用默认值；容器限制不能等同于多租户沙箱。服务目前适用于共享访问范围的团队。

## 3. 配置 HTTPS

以下示例假设域名为 `tune.example.com`。替换所有该域名后执行；如果改了 `MIWEB_PORT`，也同步修改 `deploy/nginx.conf` 中的上游端口。

```bash
sudo apt update
sudo apt install -y nginx certbot
sudo install -d -m 755 /var/www/letsencrypt
```

首次签发证书前，创建 `/etc/nginx/sites-available/miweb`，只包含以下 HTTP 配置：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name tune.example.com;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
    }
    location / { return 404; }
}
```

在没有同名站点配置的首次部署上启用站点，保留服务器已有站点：

```bash
sudo ln -s /etc/nginx/sites-available/miweb /etc/nginx/sites-enabled/miweb
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/letsencrypt -d tune.example.com
```

编辑项目内 `deploy/nginx.conf` 中的域名与证书路径，然后替换刚建立的 Miweb HTTP 配置：

```bash
sudo install -m 644 deploy/nginx.conf /etc/nginx/sites-available/miweb
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run
```

配置续期后重载 Nginx（目录不存在时先创建）：

```bash
sudo install -d /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nnginx -t && systemctl reload nginx\n' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/miweb-nginx >/dev/null
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/miweb-nginx
```

站点配置保留 Host，提供 120 秒代理超时与 36 MB 请求体上限，转发网站根路径。不要给整个站点额外加一条未经验证的全局 CSP：画布需要自己的 sandbox/CSP 与 iframe 资源策略。

## 4. 上线验收

1. 打开实际 HTTPS 域名，输入密钥，确认示例能加载。选中按钮，方向键移动、拖动、调整尺寸、撤销/重做、复制代码，并查看导出差异。
2. 输入一个允许公开访问的真实页面，确认图片和样式加载；只编辑当前地址。链接模式得到布局补丁，构建后的网址不能还原构建前的 React/Vue 源码。
3. 上传自己的一个 HTML、React 或 Vue 项目，确认源码映射、复制、下载正常；把导出的源码放回项目启动，检查结果。直接上传项目支持范围与依赖限制见根目录 README。
4. 在浏览器控制台确认没有 mixed-content、错误来源或资源 401/403。上传接近业务实际规模的项目确认未被 Nginx 请求体限制拦截。
5. 重启容器，确认站点恢复健康。重启会清空服务端会话，旧画布需要重新导入；复制/下载的代码不会丢失。

仓库提供独立生产容器回归：

```bash
# 在有 Node.js 22.12+ 与 Docker 的验证机器上；无需先 npm install。
node tests/docker-smoke.mjs --build --image=miweb:verify
# 同时验证验证机器可访问的公开网址（此项依赖目标网站和网络）。
node tests/docker-smoke.mjs --image=miweb:verify --url=https://example.com
# 单独检查 Nginx HTTPS 模板；需要 openssl，默认使用 nginx:stable。
node deploy/check-nginx.mjs
# 加上 --proxy，用上述镜像验证真正经过 HTTPS/Nginx 的捕获与导出。
node deploy/check-nginx.mjs --proxy --image=miweb:verify
```

容器回归脚本用实际 `compose.yaml` 创建唯一命名、只绑定随机 loopback 端口的临时项目，验证 Linux 非 root Chromium、访问密钥、来源检查、公开模式地址限制、示例、HTML 源码保留、React/Vue 文件夹导入、源码导出及重新导入后的位移/尺寸。结束只清理本次容器与网络，保留镜像。

Nginx 检查脚本用一次性自签名证书检查配置语法；`--proxy` 还会启动临时 Nginx 和 Miweb，共享两者的测试网络命名空间，使用原配置中的 `127.0.0.1:4173` 上游，验证 HTTPS、静态页面、密钥/来源检查、Chromium 捕获和源码导出。测试客户端只信任本次证书并验证域名，证书与测试容器随后清理，不安装主机配置。可用 `NGINX_IMAGE` 指定已安装的 Nginx 镜像、`OPENSSL_PATH` 指定 OpenSSL 可执行文件。上述测试不验证公网 DNS、真实签发证书、任意第三方网站或目标 Ubuntu 主机；这些必须按以上步骤在实际服务器验收。

## 更新、回滚与排障

```bash
# 更新前为当前镜像加一个明确版本标签，记录该标签用于回滚。
sudo docker image tag miweb:local miweb:before-update-20261013
# 放入新源码后重建并等待健康；不要同时运行两个占用同一端口的实例。
sudo docker compose --env-file deploy/production.env up -d --build --wait --wait-timeout 180
sudo docker compose --env-file deploy/production.env logs --tail=100 miweb
sudo docker stats --no-stream
```

回滚时把 `deploy/production.env` 的 `MIWEB_IMAGE` 改为保存的镜像标签，再执行 `sudo docker compose --env-file deploy/production.env up -d --no-build --wait --wait-timeout 180`。保留源代码和部署密钥的受控备份；会话不持久化，不适用数据库备份步骤。默认只有一个实例，多副本需要额外设计会话路由和存储。

- 502：检查容器状态、`/api/health` 和上游端口；`nginx -t` 通过只说明配置语法正确。
- 请求来源不匹配：核对 `PUBLIC_ORIGIN` 是否与地址栏的 scheme/domain/port 完全一致。
- 示例无法打开：检查容器日志和内存，确认构建包含 Chromium；成功健康检查不等于浏览器已启动。
- 网站导入失败：检查服务器到目标的 DNS/TLS/网络连通性。登录、反自动化、Canvas、跨域内嵌内容等限制见 README。
- 旧画布过期：重新导入，完成微调后及时导出；重启与空闲超时会清空会话。

本仓库的容器测试记录证明的环境是本机 Docker Linux 容器。获得实际服务器访问权、DNS 与证书并执行验收前，不视为已经完成 Ubuntu 主机上线。
