# 初始化素材桶，仅发布大屏读取所需的对象前缀。
set -eu

case "${OSS_INIT_BUCKET:-true}" in
  true) ;;
  false) exit 0 ;;
  *) printf '%s\n' 'OSS_INIT_BUCKET 必须为 true 或 false' >&2; exit 2 ;;
esac

mc alias set dt "$OSS_ENDPOINT" "$OSS_ACCESS_KEY" "$OSS_SECRET_KEY"
mc mb --ignore-existing "dt/$OSS_BUCKET"
for prefix in models images icons; do
  mc anonymous set download "dt/$OSS_BUCKET/$prefix"
done
