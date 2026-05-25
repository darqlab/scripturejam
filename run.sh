#!/usr/bin/env bash
# run.sh — scripturejam dev runner
# Usage: ./run.sh [up|start|stop|restart|test|logs|status]
set -euo pipefail

SERVICE="app"
cmd="${1:-up}"

case "$cmd" in
  up)       docker-compose -f deploy/docker-compose.yml up --build ;;
  start)    docker-compose -f deploy/docker-compose.yml up -d --build && echo "Started. Logs: ./run.sh logs" ;;
  stop)     docker-compose -f deploy/docker-compose.yml down ;;
  restart)  docker-compose -f deploy/docker-compose.yml down && docker-compose -f deploy/docker-compose.yml up -d --build ;;
  test)     echo "No automated tests defined" ;;
  logs)     docker-compose -f deploy/docker-compose.yml logs -f "$SERVICE" ;;
  status)   docker-compose -f deploy/docker-compose.yml ps ;;
  *)        echo "Usage: $0 {up|start|stop|restart|test|logs|status}"; exit 1 ;;
esac
