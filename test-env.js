require('dotenv').config();

console.log('Environment Variables Check:');
console.log('----------------------------');
console.log('SLACK_BOT_TOKEN:', process.env.SLACK_BOT_TOKEN ? '✅ Present' : '❌ Missing');
console.log('SLACK_SIGNING_SECRET:', process.env.SLACK_SIGNING_SECRET ? '✅ Present' : '❌ Missing');
console.log('SLACK_APP_TOKEN:', process.env.SLACK_APP_TOKEN ? '✅ Present' : '❌ Missing');
console.log('BACKEND_API_URL:', process.env.BACKEND_API_URL ? '✅ Present' : '⚠️  Not set (optional)');
console.log('\nToken Prefixes:');
console.log('----------------------------');
console.log('Bot Token starts with xoxb-:', process.env.SLACK_BOT_TOKEN?.startsWith('xoxb-') ? '✅ Yes' : '❌ No');
console.log('App Token starts with xapp-:', process.env.SLACK_APP_TOKEN?.startsWith('xapp-') ? '✅ Yes' : '❌ No');