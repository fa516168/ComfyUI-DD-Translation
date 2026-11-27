import { app } from "../../../scripts/app.js";
import { applyMenuTranslation, createWidgetDrawTextTranslator } from "./MenuTranslate.js";
import { applyNodeDescTranslation } from "./NodeDefinitionTranslation.js";
import { applyNodeTranslation } from "./NodeInstanceTranslation.js";
import { installTranslationFeatures, runTranslationInit } from "./TranslationBootstrap.js";
import {
  applyVueNodeDefTranslation,
  applyVueNodeDisplayNameTranslation,
  applyVueNodeTranslation,
} from "./VueNodeTranslation.js";
import {
  containsChineseCharacters,
  isAlreadyTranslated,
  hasNativeTranslation,
  nativeTranslatedSettings,
  isTranslationEnabled,
  toggleTranslation,
  initConfig,
  error,
  isVueNodes2,
  applySuffixHeuristic
} from "./utils.js";

export class TUtils {
  static T = {
    Menu: {},
    Nodes: {},
    NodeCategory: {},
    Groups: {},
  };
  static _mapLookupCache = new WeakMap();
  static _placeholderPatternCache = new WeakMap();

  static canonicalizeMenuText(raw) {
    if (typeof raw !== "string") return "";
    return raw
      .replace(/\uFE0F/g, "")
      .replace(/&nbsp;|&#160;|\u00A0/gi, " ")
      .replace(/\s+/g, " ")
      .replace(/\);\s*;$/, ")")
      .replace(/\s*;\s*$/, "")
      .trim();
  }

  static normalizeLookupKey(raw) {
    return TUtils.canonicalizeMenuText(raw).toLowerCase().replace(/[_\s-]/g, "");
  }

  static buildMapLookupCache(map) {
    if (!map || typeof map !== "object") return null;
    const cached = TUtils._mapLookupCache.get(map);
    if (cached) return cached;

    const exact = new Map();
    const lower = new Map();
    const normalized = new Map();

    for (const key in map) {
      if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
      const value = map[key];
      if (typeof value !== "string") continue;

      if (!exact.has(key)) exact.set(key, value);

      const lowerKey = String(key).toLowerCase();
      if (!lower.has(lowerKey)) lower.set(lowerKey, value);

      const normalizedKey = TUtils.normalizeLookupKey(key);
      if (normalizedKey && !normalized.has(normalizedKey)) {
        normalized.set(normalizedKey, value);
      }
    }

    const result = { exact, lower, normalized };
    TUtils._mapLookupCache.set(map, result);
    return result;
  }

  static buildPlaceholderPatternCache(map) {
    if (!map || typeof map !== "object") return [];
    const cached = TUtils._placeholderPatternCache.get(map);
    if (cached) return cached;

    const entries = [];
    for (const key in map) {
      if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
      if (!key || (!(key.includes("${")) && !(key.includes("{") && key.includes("}")))) {
        continue;
      }

      try {
        let regexStr = TUtils.canonicalizeMenuText(key).replace(/[.*+?^${}()|[\]\\]/g, (m) => {
          if (m === "$" || m === "{" || m === "}") return m;
          return `\\${m}`;
        });

        regexStr = regexStr
          .replace(/\$\{[^}]*\}/g, "(.*?)")
          .replace(/\{[^}]*\}/g, "(.*?)")
          .replace(/\s+/g, "\\s+");

        entries.push({
          key,
          translated: map[key],
          placeholders: key.match(/\$\{[^}]*\}|\{[^}]*\}/g) || [],
          regex: new RegExp(`^${regexStr}$`),
        });
      } catch (e) {
        // 忽略单条模板构建失败
      }
    }

    TUtils._placeholderPatternCache.set(map, entries);
    return entries;
  }

  static isLikelyModelMenuLabel(text) {
    if (typeof text !== "string") return false;
    const trimmed = text.trim();
    if (!trimmed) return false;

    // 纯中文目录通常已经是最终展示文本，不需要继续做全量匹配。
    if (containsChineseCharacters(trimmed) && !/[A-Za-z]/.test(trimmed)) {
      return true;
    }

    // 模型文件、路径、目录名等动态文本，通常不应走菜单词条翻译。
    if (/[\\/]/.test(trimmed)) return true;
    if (/\.(?:safetensors|ckpt|pt|pt2|bin|pth|gguf|onnx|json|yaml|yml|txt|csv|jpg|jpeg|png|webp|gif|mp4|mov|avi|wav|mp3)$/i.test(trimmed)) {
      return true;
    }
    if (!/\s/.test(trimmed) && /[_.-]/.test(trimmed)) return true;
    if (!/\s/.test(trimmed) && /\d/.test(trimmed) && /[A-Za-z]/.test(trimmed)) return true;

    return false;
  }

  static async syncTranslation(OnFinished = () => {}) {
    try {
      // 强制先从服务器同步配置
      await initConfig();
      
      if (!isTranslationEnabled()) {
        console.log("[DD-Translation] 翻译功能已禁用");
        // 如果翻译被禁用，清空翻译数据并直接返回
        TUtils.T = {
          Menu: {},
          Nodes: {},
          NodeCategory: {},
          Groups: {},
        };
        OnFinished();
        return;
      }
      
      try {
        console.log("[DD-Translation] 正在从服务器获取翻译数据...");
        const response = await fetch("./agl/get_translation", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: `locale=zh-CN`
        });
        
        if (!response.ok) {
          throw new Error(`请求翻译数据失败: ${response.status} ${response.statusText}`);
        }
        
        const resp = await response.json();
        console.log("[DD-Translation] 翻译数据获取成功，Groups 词条数:", resp.Groups ? Object.keys(resp.Groups).length : 0);
        
        // 直接使用 Object.assign 或手动合并，不依赖 key 检查，确保 Groups 等新字段能被合并
        if (resp) {
            TUtils.T.Menu = resp.Menu || {};
            TUtils.T.Nodes = resp.Nodes || {};
            TUtils.T.NodeCategory = resp.NodeCategory || {};
            TUtils.T.Groups = resp.Groups || {};
            // 如果有其他字段，也一并合并
            for (var key in resp) {
                if (!TUtils.T.hasOwnProperty(key)) {
                    TUtils.T[key] = resp[key];
                }
            }
        }
        
        const isComfyUIChineseNative = document.documentElement.lang === 'zh-CN';
        
        if (isComfyUIChineseNative) {
          const originalMenu = TUtils.T.Menu || {};
          TUtils.T.Menu = {};
          for (const key in originalMenu) {
            if (!nativeTranslatedSettings.includes(key) && 
                !nativeTranslatedSettings.includes(originalMenu[key]) &&
                !containsChineseCharacters(key)) {
              TUtils.T.Menu[key] = originalMenu[key];
            }
          }
        } else {
          // 将 NodeCategory 合并到 Menu 中，但保留 Menu 原有词条优先级。
          // 这样可避免同名键（如 "$$canvas-image-preview"）被分类词条错误覆盖。
          TUtils.T.Menu = Object.assign({}, TUtils.T.NodeCategory || {}, TUtils.T.Menu || {});
        }
        
        // 提取 Node 中 key 到 Menu
        for (let key in TUtils.T.Nodes) {
          let node = TUtils.T.Nodes[key];
          if(node && node["title"]) {
            TUtils.T.Menu = TUtils.T.Menu || {};
            TUtils.T.Menu[key] = node["title"] || key;
          }
        }
        
      } catch (e) {
        error("获取翻译数据失败:", e);
      }
      
      if (isTranslationEnabled()) {
        applyMenuTranslation(TUtils.T);
      }
      
      OnFinished();
    } catch (err) {
      error("同步翻译过程出错:", err);
      OnFinished();
    }
  }
    static getTranslationFromMap(map, key, isPrivateMap = false) {
      if (!map || !key) return null;
      if (typeof key !== "string") return null;

      // 1. 优先精准匹配 (如果是私有地图，这里必须拥有最高优先级)
      if (key in map) return map[key];

      // 2. 忽略大小写和下划线、空格的匹配
      const cache = TUtils.buildMapLookupCache(map);
      const normalizedKey = TUtils.normalizeLookupKey(key);

      // 尝试全小写匹配（常见的半精准匹配）
      const lowerKey = key.toLowerCase();
      if (lowerKey in map) return map[lowerKey];
      const lowerMatched = cache?.lower?.get(lowerKey);
      if (lowerMatched) return lowerMatched;

      const normalizedMatched = cache?.normalized?.get(normalizedKey);
      if (normalizedMatched) return normalizedMatched;

      // 3. 检查是否有数字后缀 (例如 "horizontal_angle 19")
      const numMatch = key.match(/^(.+?)(\s*\d+)$/);
      if (numMatch) {
        const base = numMatch[1].trim();
        const num = numMatch[2];
        const baseTr = TUtils.getTranslationFromMap(map, base, isPrivateMap);
        if (baseTr) return baseTr + num;
      }

      // 4. 只有非私有地图（即 Groups 这种通用匹配）才应用前缀猜测，
      //    或者是私有地图但实在找不到了才作为最后手段。
      //    这样可以防止猜测逻辑覆盖掉用户自己在 JSON 里写的精准翻译。
      if (key.includes('_')) {
        const parts = key.split('_');
        const lastPart = parts[parts.length - 1];
        if (lastPart.length > 2) {
          const lastTr = TUtils.getTranslationFromMap(map, lastPart, isPrivateMap);
          if (lastTr && containsChineseCharacters(lastTr)) {
            const prefix = parts.slice(0, -1).join('_');
            const prefixMap = {
              "should": "是否",
              "wait": "等待",
              "enable": "启用",
              "use": "使用",
              "is": "是否"
            };
            const pTr = prefixMap[prefix.toLowerCase()];
            if (pTr) {
              return pTr + lastTr;
            }
          }
        }
      }

      return null;
    }

    static getSimpleKeyMatch(map, key) {
      if (!map || !key) return null;
      if (typeof key !== "string") return null;
      if (key in map) return map[key];
      const lowerKey = key.toLowerCase();
      if (lowerKey in map) return map[lowerKey];
      const cache = TUtils.buildMapLookupCache(map);
      const lowerMatched = cache?.lower?.get(lowerKey);
      if (lowerMatched) return lowerMatched;
      const normalizedKey = TUtils.normalizeLookupKey(key);
      const normalizedMatched = cache?.normalized?.get(normalizedKey);
      if (normalizedMatched) return normalizedMatched;
      return null;
    }

    static getNodeConfigForClassType(class_type) {
      if (!class_type) return null;
      const nodesT = TUtils.T.Nodes || {};
      if (nodesT.hasOwnProperty(class_type)) return nodesT[class_type];
      const lower = class_type.toLowerCase();
      if (nodesT.hasOwnProperty(lower)) return nodesT[lower];
      for (const key in nodesT) {
        if (typeof key === "string" && key.toLowerCase() === lower) {
          return nodesT[key];
        }
      }
      const normalize = (str) => {
        if (!str) return "";
        let s = String(str).trim();
        if (s.includes("/")) {
          const parts = s.split("/");
          s = parts[parts.length - 1] || s;
        }
        // 移除括号及其内容的逻辑会导致 LoraLoaderBypassModelOnly 匹配到 LoraLoaderBypass
        // s = s.replace(/\s*\([^)]*\)\s*$/g, "");
        return s.toLowerCase().replace(/[^a-z0-9]/g, "");
      };
      const normalized = normalize(class_type);
      // 中文名归一化后为空串，会错误命中翻译表里第一个中文键，直接跳过模糊匹配
      if (!normalized) return null;
      for (const key in nodesT) {
        if (normalize(key) === normalized) {
          return nodesT[key];
        }
      }
      return null;
    }

    static getOutputTranslation(t, key) {
      if (!key) return null;
      
      let tr = null;
      const normalizedKey = String(key || "").toLowerCase();
      const isSimpleKey = normalizedKey === "text_out";
      if (t && t["outputs"]) {
        if (isSimpleKey) {
          tr = TUtils.getSimpleKeyMatch(t["outputs"], key);
        } else {
          tr = TUtils.getTranslationFromMap(t["outputs"], key, true);
        }
        if (!tr && t["outputs"]["*"]) tr = t["outputs"]["*"];
      }
      
      if (!tr) {
        const menu = TUtils.T.Menu || TUtils.T.menu || {};
        if (isSimpleKey) {
          tr = TUtils.getSimpleKeyMatch(menu, key);
        } else {
          tr = TUtils.getTranslationFromMap(menu, key, false);
        }
      }
      
      if (!tr) {
        const groups = TUtils.T.Groups || TUtils.T.groups || {};
        if (isSimpleKey) {
          tr = TUtils.getSimpleKeyMatch(groups, key);
        } else {
          tr = TUtils.getTranslationFromMap(groups, key, false);
        }
      }
      
      if (!tr && t && t["outputs"] && t["outputs"]["samples"] && /_samples$/.test(key)) {
        tr = t["outputs"]["samples"];
      }
      
      return tr;
    }

    static getInputTranslationDict(t, key) {
      if (!key) return null;
      
      let tr = null;
      const normalizedKey = String(key || "").toLowerCase();
      const isSimpleKey = normalizedKey === "text_in" || normalizedKey === "weight";
      if (t) {
        if (isSimpleKey) {
          tr = TUtils.getSimpleKeyMatch(t["inputs"], key);
        } else {
          tr = TUtils.getTranslationFromMap(t["inputs"], key, true);
        }
        if (!tr && t["inputs"] && t["inputs"]["*"]) tr = t["inputs"]["*"];
      }
      
      if (!tr) {
        const menu = TUtils.T.Menu || TUtils.T.menu || {};
        if (isSimpleKey) {
          tr = TUtils.getSimpleKeyMatch(menu, key);
        } else {
          tr = TUtils.getTranslationFromMap(menu, key, false);
        }
      }
      
      if (!tr) {
        const groups = TUtils.T.Groups || TUtils.T.groups || {};
        if (isSimpleKey) {
          tr = TUtils.getSimpleKeyMatch(groups, key);
        } else {
          tr = TUtils.getTranslationFromMap(groups, key, false);
        }
      }
      
      if (!tr && !isSimpleKey) {
        tr = applySuffixHeuristic(key);
      }
      
      return tr;
    }
    static getWidgetTranslationDict(t, key) {
      if (!key) return null;
      
      let tr = null;
      const normalizedKey = String(key || "").toLowerCase();
      const isSimpleKey = normalizedKey === "text_in" || normalizedKey === "weight";
      if (t) {
        if (isSimpleKey) {
          tr = TUtils.getSimpleKeyMatch(t["widgets"], key);
        } else {
          tr = TUtils.getTranslationFromMap(t["widgets"], key, true);
        }
        if (!tr && t["widgets"] && t["widgets"]["*"]) tr = t["widgets"]["*"];
      }
      
      if (!tr) {
        const menu = TUtils.T.Menu || TUtils.T.menu || {};
        if (isSimpleKey) {
          tr = TUtils.getSimpleKeyMatch(menu, key);
        } else {
          tr = TUtils.getTranslationFromMap(menu, key, false);
        }
      }
      
      if (!tr) {
        const groups = TUtils.T.Groups || TUtils.T.groups || {};
        if (isSimpleKey) {
          tr = TUtils.getSimpleKeyMatch(groups, key);
        } else {
          tr = TUtils.getTranslationFromMap(groups, key, false);
        }
      }
      
      if (!tr && !isSimpleKey) {
        tr = applySuffixHeuristic(key);
      }
      
      return tr;
    }

  static addPanelButtons(app) {
  }

}

window.TUtils = TUtils;

function applyNodeTranslationIfAlive(node) {
  if (!node || (!node.graph && !node.comfyApp)) return false;
  applyNodeTranslation(node, { TUtils });
  return true;
}

function scheduleDeferredNodeTranslation(node) {
  if (!node) return;

  if (!node._dd_translation_retry_timers) {
    node._dd_translation_retry_timers = [];
  }

  node._dd_translation_retry_timers.forEach((timerId) => clearTimeout(timerId));
  node._dd_translation_retry_timers = [];

  [120, 500, 1000].forEach((delay) => {
    const timerId = setTimeout(() => {
      applyNodeTranslationIfAlive(node);
    }, delay);
    node._dd_translation_retry_timers.push(timerId);
  });
}

const ext = {
  name: "AIGODLIKE.Translation",
    async init(app) {
    console.log("[DD-Translation] 扩展 init 开始...");
    try {
      await initConfig();
      await TUtils.syncTranslation();
      runTranslationInit(app, {
        TUtils,
        isTranslationEnabled,
        error,
      });
    } catch (e) {
      error("扩展初始化失败:", e);
    }
  },
    async setup(app) {
    console.log("[DD-Translation] 扩展 setup 开始...");
    try {
      installTranslationFeatures(app, {
        TUtils,
        LiteGraph,
        LGraphCanvas,
        isTranslationEnabled,
        isVueNodes2,
        toggleTranslation,
        error,
        createWidgetDrawTextTranslator,
      });
    } catch (e) {
      error("扩展设置失败:", e);
    }
  },
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
    try {
      applyNodeDescTranslation(nodeType, nodeData, app, { TUtils });
    } catch (e) {
      error(`注册节点定义前处理失败 (${nodeType?.comfyClass || '未知'}):`, e);
    }
  },
    beforeRegisterVueAppNodeDefs(nodeDefs) {
    try {
      // 如果翻译被禁用，直接返回
      if (!isTranslationEnabled()) {
        return;
      }
      
      nodeDefs.forEach((nodeDef) => applyVueNodeDisplayNameTranslation(nodeDef, { TUtils }));
      nodeDefs.forEach((nodeDef) => applyVueNodeTranslation(nodeDef, { TUtils }));
      nodeDefs.forEach((nodeDef) => applyVueNodeDefTranslation(nodeDef, { TUtils }));
    } catch (e) {
      error("注册Vue应用节点定义前处理失败:", e);
    }
  },
  loadedGraphNode(node, app) {
    try {
      // 1. 立即尝试翻译
      applyNodeTranslation(node, { TUtils });

      // 2. 统一延迟重试，避免对同一节点重复堆积多个定时器批次
      scheduleDeferredNodeTranslation(node);
    } catch (e) {
      error(`加载图表节点处理失败 (${node?.title || '未知'}):`, e);
    }
  },
  
  nodeCreated(node, app) {
    try {
      // 1. 立即尝试翻译一次
      applyNodeTranslation(node, { TUtils });
      
      // 2. 注入 onConfigure 钩子。当从工作流加载节点配置时，会触发这个方法。
      // 许多动态节点（如 Qwen 系列）在配置完成后才会生成最终的组件。
      if (!node._dd_translation_onconfigure_wrapped) {
        const orgOnConfigure = node.onConfigure;
        node.onConfigure = function() {
          const res = orgOnConfigure?.apply(this, arguments);
          // 配置完成后，再次应用翻译，并重新安排一次延迟补偿
          applyNodeTranslation(this, { TUtils });
          scheduleDeferredNodeTranslation(this);
          return res;
        };
        node._dd_translation_onconfigure_wrapped = true;
      }

      // 3. 针对那些异步加载组件的节点，我们在多个时间点进行重试
      // 这样可以最大程度保证“自动翻译”生效，同时避免重复定时器堆积
      scheduleDeferredNodeTranslation(node);
    } catch (e) {
      error(`创建节点处理失败 (${node?.title || '未知'}):`, e);
    }
  },
};

app.registerExtension(ext);
