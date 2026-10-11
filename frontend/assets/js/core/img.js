/* 圖片解析器：後端只傳代碼，前端拼出 Cloudflare 邊緣 URL
 * 
 * 架構：
 * - 後端 API 只回傳短代碼，如 { "pet": "baby", "bg": "cabin-warm" }
 * - 前端用 IMG.resolve('pet', 'baby') 拼出完整 URL
 * - 圖片全放在 GitHub frontend/assets/img/，由 Cloudflare 從邊緣快取提供
 * - 後端零圖片流量，只傳幾個字串，延遲最低
 */
(function() {
  // 圖片根路徑（相對於網站根）
  var BASE = '/assets/img';
  
  // 代碼 → 檔案路徑映射表（只放已存在的圖）
  var MAP = {
    pet: {
      'egg': 'game/pet-egg.webp',
      'baby': 'game/pet-baby.webp',
      'adult': 'game/pet-adult.webp',
    },
    emblem: {
      'duel': 'emblem-duel.webp',
      'explore': 'emblem-explore.webp',
      'island': 'emblem-island.webp',
      'market': 'emblem-market.webp',
      'pet': 'emblem-pet.webp',
      'library': 'emblem-library.webp',
      'quiz': 'emblem-quiz.webp',
      'bookshelf': 'emblem-bookshelf.webp',
      'favorites': 'emblem-favorites.webp',
      'mastery': 'emblem-mastery.webp',
    },
  };
  
  // 版本號（更新圖片時改這裡，強制刷新快取）
  var VERSION = '3.0.0';
  
  window.IMG = {
    /**
     * 解析圖片 URL
     * @param {string} category - 分類 (pet, bg, furniture, emblem, character)
     * @param {string} code - 代碼 (如 'baby', 'cabin-warm')
     * @returns {string} 完整圖片 URL
     */
    resolve: function(category, code) {
      var path = (MAP[category] && MAP[category][code]) || null;
      if (!path) {
        console.warn('[IMG] 找不到圖片:', category, code);
        return BASE + '/placeholder.webp?v=' + VERSION;
      }
      return BASE + '/' + path + '?v=' + VERSION;
    },
    
    /**
     * 從後端回傳的物件批量解析
     * @param {object} codes - 如 { pet: 'baby', bg: 'cabin-warm' }
     * @returns {object} 如 { pet: '/assets/img/game/pet-baby.webp?v=3.0.0', ... }
     */
    resolveAll: function(codes) {
      var result = {};
      for (var key in codes) {
        if (codes.hasOwnProperty(key)) {
          result[key] = this.resolve(key, codes[key]);
        }
      }
      return result;
    }
  };
})();
