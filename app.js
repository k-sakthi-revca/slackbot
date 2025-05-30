require('dotenv').config();
const { App } = require('@slack/bolt');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

// WebSocket connection management
let ws = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 1000;



// Initialize your app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// Global variables for message handling
let currentMessage = null;
let messageContent = '';
let lastUpdateTime = 0;
let isStreaming = false;
const updateInterval = 500; // Update every 500ms

// Function to establish WebSocket connection
const establishConnection = (say) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const sessionId = uuidv4();
    ws = new WebSocket(`wss://agent-backend.openana.ai/devops/api/v1/ws/streaming/chat/${sessionId}`);

    ws.on('open', () => {
      console.log('Connected to backend WebSocket');
      reconnectAttempts = 0;
      resolve();
    });

    // Set up WebSocket message handler
    ws.on('message', async (data) => {
      try {
        const message = data.toString();
        let jsonMessage;
        
        try {
          jsonMessage = JSON.parse(message);
        } catch (parseError) {
          console.error('Failed to parse WebSocket message:', parseError);
          return;
        }

        // For connection message, just log and continue
        if (jsonMessage.content?.includes('Connected to ANA Multi-Agent')) {
          console.log('Received connection confirmation');
          return;
        }

        // Handle error messages
        if (jsonMessage.type === 'error') {
          await handleErrorMessage(jsonMessage, currentMessage, app);
          return;
        }

        // Handle stream complete
        if (jsonMessage.type === 'stream_complete') {
          console.log('Stream completed');
          isStreaming = false;
          // Only reset if we were streaming
          if (messageContent) {
            await updateSlackMessage(messageContent);
            messageContent = '';
            lastUpdateTime = 0;
          }
          return;
        }

        // Handle streaming chunks
        if (jsonMessage.type === 'stream_chunk' && jsonMessage.content) {
          isStreaming = true;
          messageContent += jsonMessage.content;
          
          // Update the message in Slack with rate limiting
          const now = Date.now();
          if (now - lastUpdateTime >= updateInterval) {
            await updateSlackMessage(messageContent);
            lastUpdateTime = now;
          }
          return;
        }

        // Handle complete messages (non-streaming)
        if ((jsonMessage.type === 'chat_response' || jsonMessage.type === 'stream') && jsonMessage.content && !isStreaming) {
          await handleChatResponse(jsonMessage, currentMessage, app);
        }
      } catch (error) {
        console.error('Error handling message:', error);
      }
    });

    ws.on('error', async (error) => {
      console.error('WebSocket error:', error);
      if (currentMessage) {
        try {
          await app.client.chat.update({
            channel: currentMessage.channel,
            ts: currentMessage.ts,
            text: "❌ Sorry, there was an error processing your request.",
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: "❌ Sorry, there was an error processing your request."
                }
              }
            ]
          });
        } catch (updateError) {
          console.error('Error updating error message:', updateError);
        }
      }
      reject(error);
    });

    ws.on('close', () => {
      console.log('Backend WebSocket connection closed');
      ws = null;

      // Attempt to reconnect if not at max attempts
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        setTimeout(() => {
          reconnectAttempts++;
          console.log(`Reconnecting... Attempt ${reconnectAttempts}`);
          establishConnection();
        }, RECONNECT_DELAY * reconnectAttempts);
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      reject(error);
    });
  });
};

// Function to handle WebSocket message sending
const sendWebSocketMessage = async (userMessage, say) => {
  try {
    // Ensure connection is established
    await establishConnection(say);

    // Send initial thinking message and store it globally
    const response = await say({
      text: "🤔 Thinking...",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "🤔 Thinking..."
          }
        }
      ]
    });
    
    // Set the global currentMessage
    currentMessage = response;
    messageContent = '';
    lastUpdateTime = 0;
    isStreaming = false;

    // Format and send message
    const messagePayload = {
      type: "chat",
      content: userMessage
    };

    console.log('Sending message payload:', messagePayload);
    ws.send(JSON.stringify(messagePayload));

    

  } catch (error) {
    console.error('Error in sendWebSocketMessage:', error);
    if (currentMessage) {
      await handleErrorMessage({ error: error.message }, currentMessage, app);
    }
    throw error;
  }
};

// Handle direct messages and channel messages
app.message(async ({ message, say }) => {
  try {
    if (message.subtype === 'bot_message') return;

    // Ensure message.text exists before using it
    if (!message.text) {
      console.log('Received message without text:', message);
      return;
    }

    console.log('Received message:', message.text);
    
    if (message.text.toLowerCase() === 'hello') {
      await say({
        text: `Hey there <@${message.user}>! 👋\nI'm your DevOps assistant. How can I help you today?`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Hey there <@${message.user}>! 👋\nI'm your DevOps assistant. How can I help you today?`
            }
          }
        ]
      });
      return;
    }

    await sendWebSocketMessage(message.text, say);

  } catch (error) {
    console.error('Error in message handler:', error);
    await say({
      text: 'Sorry, there was an error processing your message.',
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "❌ Sorry, there was an error processing your message."
          }
        }
      ]
    });
  }
});

// Handle app mentions
app.event('app_mention', async ({ event, say }) => {
  try {
    console.log('Received mention:', event);
    
    // Extract the actual message (remove the bot mention)
    const message = event.text.replace(/<@[A-Z0-9]+>/, '').trim();
    
    if (!message) {
      await say({
        text: `Hi <@${event.user}>! How can I help you?`,
        thread_ts: event.thread_ts || event.ts,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Hi <@${event.user}>! How can I help you?`
            }
          }
        ]
      });
      return;
    }

    // Send message using WebSocket
    await sendWebSocketMessage(message, say);

  } catch (error) {
    console.error('Error in app_mention handler:', error);
    await say({
      text: 'Sorry, there was an error processing your mention.',
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "❌ Sorry, there was an error processing your mention."
          }
        }
      ]
    });
  }
});

// Helper functions for message handling
const handleErrorMessage = async (jsonMessage, currentMessage, app) => {
  try {
    await app.client.chat.update({
      channel: currentMessage.channel,
      ts: currentMessage.ts,
      text: `❌ Error: ${jsonMessage.error}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `❌ Error: ${jsonMessage.error}`
          }
        }
      ]
    });
  } catch (error) {
    console.error('Error updating error message:', error);
  }
};

// Helper function to update Slack message
const updateSlackMessage = async (content) => {
  if (!currentMessage || !content) return;

  try {
    await app.client.chat.update({
      channel: currentMessage.channel,
      ts: currentMessage.ts,
      text: content,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: content
          }
        }
      ]
    });
  } catch (error) {
    if (error.code === 'rate_limited') {
      const retryAfter = parseInt(error.retryAfter) || 1;
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      await updateSlackMessage(content);
    } else {
      console.error('Error updating message:', error);
    }
  }
};

const handleChatResponse = async (jsonMessage, currentMessage, app) => {
  try {
    let content = jsonMessage.content.trim();
    
    if (!content) return;

    console.log('Updating message with content:', content);

    const MAX_LENGTH = 3000;
    if (content.length > MAX_LENGTH) {
      // Split content into chunks while preserving markdown and code blocks
      const chunks = [];
      let currentChunk = '';
      const lines = content.split('\n');
      
      for (const line of lines) {
        if (currentChunk.length + line.length + 1 > MAX_LENGTH) {
          chunks.push(currentChunk);
          currentChunk = line;
        } else {
          currentChunk = currentChunk ? currentChunk + '\n' + line : line;
        }
      }
      if (currentChunk) {
        chunks.push(currentChunk);
      }

      console.log(`Split content into ${chunks.length} chunks`);
      
      // Update first chunk
      const updateResult = await app.client.chat.update({
        channel: currentMessage.channel,
        ts: currentMessage.ts,
        text: chunks[0],
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: chunks[0]
            }
          }
        ]
      });
      console.log('Updated first chunk:', updateResult.ok);

      // Send remaining chunks
      for (let i = 1; i < chunks.length; i++) {
        const postResult = await app.client.chat.postMessage({
          channel: currentMessage.channel,
          thread_ts: currentMessage.ts,
          text: chunks[i],
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: chunks[i]
              }
            }
          ]
        });
        console.log(`Posted chunk ${i + 1}:`, postResult.ok);
      }

      if (updateResult.ok) {
        currentMessage.text = content;
        console.log('Successfully updated Slack message with chunked content');
      }
    } else {
      await app.client.chat.update({
        channel: currentMessage.channel,
        ts: currentMessage.ts,
        text: content,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: content
            }
          }
        ]
      });
    }
  } catch (error) {
    console.error('Error updating chat response:', error);
  }
};


// Start the app
(async () => {
  try {
    console.log('Starting app...');
    await app.start();
    console.log('⚡️ Bolt app is running!');
  } catch (error) {
    console.error('❌ Error starting app:', error);
    if (error.data) {
      console.error('Error details:', JSON.stringify(error.data, null, 2));
    }
  }
})();

// Global error handlers
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});