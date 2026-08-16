/* 測試載入器：以瀏覽器相同的順序載入核心模組（共用 WV 命名空間） */
globalThis.WV = globalThis.WV || {};
require('../core/rng.js');
require('../core/data.js');
require('../core/data_text.js');
require('../core/data_guide.js');
require('../core/model.js');
require('../core/engine.js');
require('../core/deaths.js');
require('../core/phases_day.js');
require('../core/phases_night.js');
require('../core/views.js');
module.exports = globalThis.WV;
