#!/usr/bin/env bash
HEALTH=$(curl -s --connect-timeout 2 http://localhost:4200/api/health 2>/dev/null || echo "")
if [[ "$HEALTH" == *"ok"* ]]; then
  echo "Pipeline Dashboard 실행 중 (http://localhost:4200). '리뷰해줘' 또는 'review this code'로 파이프라인을 시작할 수 있습니다."
else
  echo "Pipeline Dashboard 사용 가능. '리뷰해줘' 또는 'review this code'를 입력하면 대시보드가 자동 시작됩니다."
fi
