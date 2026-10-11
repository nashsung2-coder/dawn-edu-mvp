/* 超時保護共用工具
 * 用法：
 *   const { data, timedOut } = await withTimeoutUI(
 *     () => api.get('/path'),
 *     document.getElementById('view'),
 *     '載入中...'
 *   );
 */
(function() {
  window.withTimeoutUI = async function(apiCall, viewEl, loadingText, timeoutMs) {
    timeoutMs = timeoutMs || 8000;
    loadingText = loadingText || '載入中...';
    
    // 顯示載入中
    var originalHTML = viewEl.innerHTML;
    viewEl.innerHTML = '<p style="text-align:center;color:#999;padding:40px">' + loadingText + '</p>';
    
    var timedOut = false;
    var timer = setTimeout(function() {
      timedOut = true;
      viewEl.innerHTML = '<div style="text-align:center;padding:40px">'
        + '<p style="color:#999">載入有點慢，再試一次吧</p>'
        + '<button onclick="location.reload()" style="padding:10px 24px;background:#1a1a1a;color:#fff;border:none;border-radius:8px;cursor:pointer;margin-top:12px">重新載入</button>'
        + '</div>';
    }, timeoutMs);
    
    try {
      var data = await apiCall();
      clearTimeout(timer);
      if (!timedOut) {
        return { data: data, timedOut: false };
      }
      return { data: null, timedOut: true };
    } catch (e) {
      clearTimeout(timer);
      if (!timedOut) {
        viewEl.innerHTML = '<div style="text-align:center;padding:40px">'
          + '<p style="color:#c00">載入失敗：' + (e.message || '未知錯誤') + '</p>'
          + '<button onclick="location.reload()" style="padding:10px 24px;background:#1a1a1a;color:#fff;border:none;border-radius:8px;cursor:pointer;margin-top:12px">重試</button>'
          + '</div>';
      }
      return { data: null, timedOut: timedOut, error: e };
    }
  };
})();
