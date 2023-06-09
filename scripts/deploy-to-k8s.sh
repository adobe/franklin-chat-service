VERSION=$1

echo "Checking if secret for docker registry $DOCKER_REGISTRY_URL exists..."
if ! kubectl get secret regcred --context "${CLUSTER_NAME//-/}" -n "$NAMESPACE" >/dev/null 2>&1; then
  echo "Creating secret for docker registry $DOCKER_REGISTRY_URL..."
  kubectl create secret docker-registry regcred --context "${CLUSTER_NAME//-/}" -n "$NAMESPACE" \
    --docker-server="$DOCKER_REGISTRY_URL" \
    --docker-username="$DOCKER_USERNAME" \
    --docker-password="$DOCKER_PASSWORD"
fi

echo "Deploying v$VERSION..."
helm upgrade "$DEPLOYMENT_NAME" "k8s" -i --kube-context "${CLUSTER_NAME//-/}" -n "$NAMESPACE" \
  --set environment="development" \
  --set clusterName="$CLUSTER_NAME" \
  --set image.tag="$VERSION" \
  --set image.repository="$DOCKER_REGISTRY_URL/$DOCKER_IMAGE_NAME" \
  --set config.serverPort="$SERVER_PORT" \
  --set config.logLevel="$LOG_LEVEL" \
  --set config.magicLinkApiKey="$MAGIC_LINK_API_KEY" \
  --set config.channelMappingUrl="$CHANNEL_MAPPING_URL" \
  --set config.slackAdminChannelId="$SLACK_ADMIN_CHANNEL_ID" \
  --set config.slackDefaultChannelId="$SLACK_DEFAULT_CHANNEL_ID" \
  --set config.slackBotToken="$SLACK_BOT_TOKEN" \
  --set config.slackAppToken="$SLACK_APP_TOKEN" \
  --set config.grafanaEnabled="$GRAFANA_ENABLED" \
  --set config.grafanaHost="$GRAFANA_HOST" \
  --set config.grafanaUserId="$GRAFANA_USER_ID" \
  --set config.grafanaPassword="$GRAFANA_PASSWORD" \
  --set config.grafanaAppName="$GRAFANA_APP_NAME"
