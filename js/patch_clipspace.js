import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "Comfy.UserPatches.ClipspaceTranslation",
    async setup() {
        // 旧的 getNodeMenuOptions/getCanvasMenuOptions monkey patch 已迁移移除。
        // Clipspace 菜单项现在由主翻译逻辑统一处理，避免触发 ComfyUI 的 deprecated 警告。
        console.log("[UserPatches] ClipspaceTranslation loaded with new menu API compatibility mode.");
    },
    getCanvasMenuItems() {
        return [];
    },
    getNodeMenuItems() {
        return [];
    }
});
