import { createApp } from "vue";

import App from "./App.vue";
import { setUnauthorizedHandler } from "./api/client";
import { useAuth } from "./composables/useAuth";
import router from "./router";
import "./styles/tokens.css";
import "./styles/web.css";

const auth = useAuth();
setUnauthorizedHandler(() => {
  auth.clear();
  const current = router.currentRoute.value;
  if (current.meta.public) return;
  if (__FUNREAD_PACKAGED__) {
    void router.replace({ name: "packaged-setup", query: { next: current.fullPath } });
    return;
  }
  void router.replace({ name: "login", query: { next: current.fullPath } });
});

createApp(App).use(router).mount("#app");
