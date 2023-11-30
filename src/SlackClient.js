/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { App as SlackApp, AwsLambdaReceiver } from '@slack/bolt';

const MAX_USERS = 250;

const SUPPORTED_MESSAGE_SUBTYPES = [
  'bot_message',
];

const { SLACK_ADMIN_CHANNEL } = process.env;
console.debug(`Slack admin channel: ${SLACK_ADMIN_CHANNEL}`);

const awsLambdaReceiver = new AwsLambdaReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const slackClient = new SlackApp({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: awsLambdaReceiver,
});

async function getUser(message) {
  if (message.subtype === 'bot_message') {
    return {
      id: message.bot_id,
      name: message.username,
    };
  }
  const { user } = await slackClient.client.users.info({
    user: message.user,
  });
  return {
    id: message.user,
    name: user.real_name,
    icon: user.profile.image_48,
  };
}

function getFiles(slackMessage) {
  if (slackMessage.files) {
    return slackMessage.files.map((file) => {
      return {
        id: file.id,
        name: file.name,
        url: file.url_private_download,
        thumbUrl: file.thumb_64,
      };
    });
  }
  return [];
}

async function replaceUserIdsWithNamesInSlackMessage(message) {
  const slackUserMentionRegex = /<@(.+?)>/g;

  const promises = [];

  let match = slackUserMentionRegex.exec(message);
  while (match) {
    const userId = match[1];
    const promise = getUser({ user: userId })
      .then(({ name: userName }) => `<@${userId}|${userName}>`)
      .catch(() => `<@${userId}>`);
    promises.push(promise);
    match = slackUserMentionRegex.exec(message);
  }

  const resolvedNames = await Promise.all(promises);

  return message.replace(slackUserMentionRegex, () => {
    const resolvedName = resolvedNames.shift();
    return resolvedName ?? ''; // return empty string if resolvedName is undefined or null
  });
}

export async function slackToInternalMessage(slackMessage) {
  const user = await getUser(slackMessage);
  return {
    ts: slackMessage.ts,
    user,
    text: await replaceUserIdsWithNamesInSlackMessage(slackMessage.text || ''),
    threadId: slackMessage.thread_ts,
    replyCount: slackMessage.reply_count,
    reactions: slackMessage.reactions,
    files: getFiles(slackMessage),
  };
}

async function slackToInternalMessages(slackMessages) {
  return Promise.all(Array.from(slackMessages
    .filter((message) => message.ts)
    .filter((message) => !message.subtype || SUPPORTED_MESSAGE_SUBTYPES.includes(message.subtype))
    .map(async (message) => {
      try {
        return await slackToInternalMessage(message);
      } catch (e) {
        console.error(`failed to convert slack message ${message.ts} to internal message`, e);
        return null;
      }
    })
    .filter((message) => message !== null)));
}

export async function postToChannel(channelId, message) {
  const { ts } = await slackClient.client.chat.postMessage({
    token: process.env.SLACK_BOT_TOKEN,
    channel: channelId,
    ...message,
  });
  return ts;
}

export async function postToAdminChannel(message) {
  return postToChannel(SLACK_ADMIN_CHANNEL, {
    text: message,
  });
}

export async function getChannelInfo(channelId) {
  const info = await slackClient.client.conversations.info({
    channel: channelId,
  });
  return {
    teamId: info.channel?.context_team_id ?? 'unknown',
    channelName: info.channel?.name ?? 'unknown',
  };
}

export async function getHistory(channel, latest) {
  const history = await slackClient.client.conversations.history({
    channel,
    include_all_metadata: true,
    limit: 20,
    latest,
  });
  return slackToInternalMessages(history.messages ?? []);
}

export async function getReplies(ts, channel) {
  const replies = await slackClient.client.conversations.replies({
    channel,
    include_all_metadata: true,
    limit: 1000, // get all replies
    ts,
  });
  return slackToInternalMessages(replies.messages ?? []);
}

export async function getMembers(channelId) {
  const members = await slackClient.client.conversations.members({
    channel: channelId,
    limit: MAX_USERS,
  });

  const memberIds = members.members ?? [];

  return Promise.all(memberIds.map(async (memberId) => {
    const { user } = await slackClient.client.users.info({ user: memberId });
    return {
      id: memberId,
      name: user.real_name,
    };
  }));
}
