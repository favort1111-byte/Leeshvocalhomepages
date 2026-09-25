/**
 * Telegram alerts. The bot token and chat id live in Script Properties
 * (프로젝트 설정 > 스크립트 속성), never in the sheet:
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 * A failed send is written to the 로그 tab and never blocks the request.
 */
function notify_(text) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TELEGRAM_BOT_TOKEN');
  var chat = props.getProperty('TELEGRAM_CHAT_ID');
  if (!token || !chat) {
    log_('알림 미설정', text);
    return false;
  }
  try {
    var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: chat, text: text, disable_web_page_preview: true }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) {
      log_('알림 실패', res.getResponseCode() + ' ' + res.getContentText().slice(0, 300) + '\n---\n' + text);
      return false;
    }
    return true;
  } catch (e) {
    log_('알림 실패', e + '\n---\n' + text);
    return false;
  }
}

/** Menu: sends a test message so the owner can confirm the bot works. */
function testTelegram() {
  var ok = notify_('✅ 이송희보컬레슨 홈페이지 알림 테스트입니다.');
  SpreadsheetApp.getUi().alert(ok
    ? '텔레그램으로 테스트 메시지를 보냈습니다.'
    : '보내지 못했습니다. 스크립트 속성의 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID와 로그 탭을 확인하세요.');
}

/**
 * Menu helper: after messaging the bot once, run this to find your chat id.
 * It reads the bot's recent updates and shows the chat ids it sees.
 */
function findTelegramChatId() {
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  var ui = SpreadsheetApp.getUi();
  if (!token) { ui.alert('먼저 스크립트 속성에 TELEGRAM_BOT_TOKEN을 넣어주세요.'); return; }
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getUpdates', { muteHttpExceptions: true });
  var data = JSON.parse(res.getContentText() || '{}');
  var seen = {};
  (data.result || []).forEach(function (u) {
    var c = (u.message || u.channel_post || u.my_chat_member || {}).chat;
    if (c) seen[c.id] = c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || '';
  });
  var ids = Object.keys(seen);
  ui.alert(ids.length
    ? '찾은 채팅:\n' + ids.map(function (id) { return id + '  (' + seen[id] + ')'; }).join('\n') +
      '\n\n받을 곳의 숫자를 스크립트 속성 TELEGRAM_CHAT_ID에 넣으세요.'
    : '아직 찾은 채팅이 없습니다. 텔레그램에서 봇에게 아무 메시지나 보낸 뒤 다시 실행하세요.');
}
