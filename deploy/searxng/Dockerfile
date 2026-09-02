# Thin SearXNG image with the JSON API enabled (stock image serves HTML only).
# Build on GitHub Actions and push to ECR as telestar-searxng:latest (no local Docker needed):
#   docker build -t <ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com/telestar-searxng:latest deploy/searxng
FROM searxng/searxng:latest
COPY settings.yml /etc/searxng/settings.yml
