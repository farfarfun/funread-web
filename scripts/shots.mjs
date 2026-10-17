/**
 * 截界面图，给 README 和 farfarfun/packages 的包页用。
 *
 *   node scripts/shots.mjs [输出目录]        默认 docs/snapshots
 *
 * 前提：`pnpm build` 出过 dist/，并且有个静态服务伺服它（CI 里是 `pnpm preview`）。
 * 地址用 SHOTS_BASE 覆盖，默认 http://localhost:8811。
 *
 * **后端是假的。** 所有 `/api/v1/**` 都被 page.route 截下来返回下面这些常量，不起
 * funread-api、不连数据库。两个理由：
 *
 * 1. 截图要的是界面长什么样，不是后端对不对 —— 后者有 tests/ 和 CI 里那几条
 *    装机验证在管；
 * 2. **同样的输入永远得到同样的像素。** 真数据截出来的图每次都有细微差别（书
 *    更新了、时间戳变了、搜索结果换了顺序），于是每次发版都多一个「只有像素
 *    变了」的提交，久了没人再看那个 diff。假数据是固定的，图只在界面真的改了
 *    的时候才变，那时的 diff 才值得看一眼。
 *
 * 外部图片（封面）也一并截掉，换成本地画的渐变块：真去 raw.githubusercontent
 * 或者书源站拉封面的话，网络一抖这张图就裂了，而裂图会被当成产品本身的问题。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { argv, env, exit } from "node:process";

import { chromium } from "playwright";

const BASE = env.SHOTS_BASE || "http://localhost:8811";
const OUT = argv[2] || "docs/snapshots";

//  手机和桌面两套视口。900 是 useViewport 的 WIDE_BREAKPOINT——窄的走底部
//  TabBar，宽的走侧栏，两种布局都要有图。deviceScaleFactor=2 出 2x 图：包页和
//  README 在高分屏上看，1x 的字会糊。
const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };

// ---------------------------------------------------------------- 假数据
//
//  书名和正文都是编的。真书名放在产品宣传图里会让人以为这软件自带内容——它不
//  自带，它读的是用户自己配的书源。

/**
 * N 小时前，格式跟后端一致（不带时区的本地时间串）。
 *
 * 时间**不能写死**：界面上显示的是「15 小时前」这种相对值，固定日期会让这个数
 * 字随截图当天的日期一路变大，于是每次发版都多一个「只有几个字变了」的 diff ——
 * 恰恰是上面说的要避免的东西。固定偏移则永远显示同一句话。
 *
 * `sv-SE` 这个 locale 给的正好是 `YYYY-MM-DD HH:mm:ss`，换个空格就是后端那种
 * 写法。指定时区是因为 runner 跑在 UTC 而页面上下文是 Asia/Shanghai，用 Node
 * 的本地时区生成会凭空差八小时。
 */
const ago = (hours) =>
  new Date(Date.now() - hours * 3600_000)
    .toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" })
    .replace(" ", "T");

const SESSION = {
  auth_required: true,
  admin: true,
  reader_public: false,
  register_open: false,
  authenticated: true,
  user_id: 1,
  username: "bingtao",
  local: false,
  role: "admin",
};

const BOOKS = [
  ["夜航船记", "周随安", "沿江而下的旧船上，记事人把每夜听来的话写进册子。", 412, 3, "江风渐起"],
  ["青石巷", "沈玉梨", "巷口的灯亮了四十年，修灯的人换了三个。", 268, 0, "第二十九盏"],
  ["山河纸上", "陆砚秋", "一个绘舆图的人，把走过的路一寸寸画下来。", 530, 12, "过陇西"],
  ["听雪录", "程知微", "雪落下来是没有声音的，除非你在等一个人。", 196, 1, "第三场雪"],
  ["长夏未尽", "何渡", "南方的夏天很长，长到足够一个人改主意。", 331, 0, "蝉鸣之后"],
  ["旧书店的猫", "林舟", "它守着三楼靠窗那排书，谁也赶不走。", 148, 5, "第七个来客"],
  ["渡口无人", "许明笙", "摆渡的老人走了以后，船还系在原处。", 224, 0, "空船"],
  ["北地来信", "苏砚", "每年冬天都会寄到一封，署名总是不同的人。", 389, 2, "第十一封"],
  ["铜钥匙", "江见月", "一把配不上任何锁的钥匙，被三代人收着。", 177, 0, "锁匠说"],
  ["沙枣与盐", "阿依古丽", "集市尽头那家铺子，只在风沙停的日子开门。", 142, 6, "风停之后"],
  ["未寄出的信", "温言", "写了很多封，一封也没有寄。", 205, 0, "第一封"],
  ["春分", "顾行舟", "节气是旧历留下来的，日子却是新的。", 312, 1, "惊蛰之后"],
];

const shelf = BOOKS.map(([name, author, intro, count, unread, last], i) => ({
  book_key: `k${i + 1}`,
  name,
  author,
  cover_url: `https://example.invalid/cover/${i + 1}.jpg`,
  intro,
  url_id: 1,
  book_url: `https://example.invalid/book/${i + 1}`,
  toc_url: `https://example.invalid/toc/${i + 1}`,
  last_chapter: last,
  updated_at: ago(6 + i),
  progress:
    i === 0
      ? {
          chapter_index: 128,
          chapter_name: "江风渐起",
          chapter_url: "",
          char_offset: 0,
          updated_at: ago(2),
        }
      : null,
  group: "",
  chapter_count: count,
  unread,
  last_checked_at: ago(6 + i),
  last_check_error: "",
}));

const BOOK = {
  name: "夜航船记",
  author: "周随安",
  book_url: "https://example.invalid/book/1",
  toc_url: "https://example.invalid/toc/1",
  kind: "随笔",
  word_count: "42 万字",
  last_chapter: "江风渐起",
  intro: "沿江而下的旧船上，记事人把每夜听来的话写进册子。",
  cover_url: "https://example.invalid/cover/1.jpg",
  source_url: "https://example.invalid",
  source_name: "示例书源",
  can_rename: false,
  variables: {},
};

const toc = Array.from({ length: 412 }, (_, i) => ({
  index: i,
  name: i === 127 ? "江风渐起" : `第${i + 1}章 ${["夜泊", "问渡", "旧识", "灯下", "远信"][i % 5]}`,
  url: `https://example.invalid/c/${i}`,
  update_time: "",
  is_vip: false,
  is_pay: false,
  variables: {},
}));

//  正文要够长才能占满一屏——短了截出来下面一大片空白，看不出这是个阅读器。
const CONTENT = {
  title: "第一百二十八章 江风渐起",
  text: [
    "船过第三个湾口的时候，风忽然大了起来。",
    "老周把册子收进怀里，抬头看了看天。云压得很低，远处的山只剩一道轮廓，像谁用淡墨随手抹了一笔。他在这条江上走了二十六年，知道这样的天色意味着什么——今夜靠不了岸了。",
    "舱里有人在说话。声音不高，断断续续地飘出来，混着水声听不真切。他没有凑过去。记事人的规矩是等别人愿意说，而不是去问。愿意说的人，自己会找过来。",
    "果然，过了一炷香的工夫，有个穿青布衫的年轻人掀帘出来，在他旁边坐下了。",
    "「先生是记事的？」",
    "老周点点头，从怀里把册子取出来，摊在膝上。纸是粗纸，边角都卷了，密密麻麻写满了字，有些地方被水洇过，墨迹晕成一团。",
    "「我想请先生记一件事。」年轻人说，「不过这件事还没有结局。」",
    "「没有结局的也可以记。」老周说，「江上的事，多半都没有结局。」",
    "年轻人笑了一下，像是松了口气。他望着船外越来越暗的水面，沉默了很久才开口。那一夜风很大，船灯晃得厉害，老周就着那点光，一直写到后半夜。",
  ].join("\n\n"),
  url: "https://example.invalid/c/127",
  next_url: "https://example.invalid/c/128",
};

//  `/admin/sources` 管的是**采集源**：产出书源列表的那些 URL，按地址标识，没有
//  名字字段（见 types.ts 的 Source）。表格列是 ID / 类型 / 地址 / 源数量 /
//  最近采集 / 状态 / 启用。
const SOURCES = [
  ["https://example.invalid/legado/shuyuan-a.json", "book", 412, 0, true],
  ["https://example.invalid/legado/shuyuan-b.json", "book", 268, 0, true],
  ["https://example.invalid/legado/合集-2026.json", "book", 1530, 2, true],
  ["https://example.invalid/legado/archive.txt", "book", 96, 0, false],
  ["https://example.invalid/rss/daily.json", "rss", 48, 0, true],
  ["https://example.invalid/rss/weekly.json", "rss", 21, 7, true],
];

//  `GET /api/v1/...` 的路径 → 返回体。前缀匹配，先命中的先用，所以长路径排前面。
const ROUTES = [
  ["/auth/me", SESSION],
  ["/shelf/groups", [{ name: "", count: shelf.length }]],
  ["/shelf", shelf],
  ["/reader/book", BOOK],
  ["/reader/toc", { items: toc, total: toc.length }],
  ["/reader/content", CONTENT],
  ["/reader/explore/sources", { items: [], total: 0 }],
  ["/sources/supported", ["book", "rss"]],
  [
    "/sources",
    {
      items: SOURCES.map(([url, source_type, source_count, fails, enabled], i) => ({
        id: i + 1,
        url,
        source_type,
        source_count,
        enabled,
        consecutive_failures: fails,
        last_error: fails ? "连接超时" : null,
        last_success_at: fails ? ago(96) : ago(2),
        increment_start: null,
        increment_stop: null,
        last_queried_at: ago(2),
        created_at: ago(24 * 46),
        updated_at: ago(2),
      })),
      total: SOURCES.length,
      limit: 50,
      offset: 0,
    },
  ],
];

function body(path) {
  for (const [prefix, data] of ROUTES) if (path.startsWith(prefix)) return data;
  //  没列进去的接口给个空壳而不是 404：界面碰到 404 会弹错误条，那东西会出现在
  //  截图里。空数组/空对象在各页面上都是「还没有内容」，不碍事。
  return path.includes("groups") || path.endsWith("s") ? [] : {};
}

/** 一张 2x1 的渐变 PNG，当封面用。不联网、不读文件。 */
function cover(seed) {
  //  手搓一个最小 PNG 太啰嗦，这里用 SVG——Chromium 当图片资源一样能渲染，而且
  //  矢量的在 2x 下不糊。
  const hues = [262, 198, 12, 155, 330, 40];
  const h = hues[seed % hues.length];
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400">
       <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
         <stop offset="0" stop-color="hsl(${h} 62% 58%)"/>
         <stop offset="1" stop-color="hsl(${(h + 38) % 360} 58% 38%)"/>
       </linearGradient></defs>
       <rect width="300" height="400" fill="url(#g)"/>
     </svg>`,
  );
}

// ---------------------------------------------------------------- 截图

async function shoot(browser, { file, path, viewport, dark, wait }) {
  const context = await browser.newContext({
    ...viewport,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    //  别让「减少动态效果」之外的动画把截图截在半路上。
    reducedMotion: "reduce",
  });

  //  主题在页面脚本跑起来之前塞进去：useTheme 和 useReaderSettings 都是在模块
  //  加载时读 localStorage 的，等页面起来再设就晚了，得刷新一次才生效。
  //
  //  两个键，不是一个。外壳主题（列表、卡片、按钮）和正文配色是分开的两套 ——
  //  「深色外壳配纸白正文」是常见搭配，所以 useReaderSettings 自己存一份。只设
  //  前者的话，read-dark 截出来还是纸白的，和 read-light 一模一样。
  await context.addInitScript(
    ([theme]) => {
      localStorage.setItem("funread.theme", theme);
      localStorage.setItem(
        "funread.reader.settings",
        JSON.stringify({ theme: theme === "dark" ? "night" : "paper" }),
      );
    },
    [dark ? "dark" : "light"],
  );

  const page = await context.newPage();

  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body(url.pathname.replace(/^\/api\/v1/, ""))),
    });
  });

  //  所有站外图片换成本地渐变块。走网络的话，网络一抖封面就裂，而裂图看起来
  //  像是产品本身坏了。
  //
  //  **注册在 API 那条之后**，而且非图片一律 fallback，两件事缺一不可：Playwright
  //  是后注册的先匹配，而「站外」这个正则会连 API 请求一起命中 —— `/reader/book`
  //  的 query 里就带着 `book_url=https://example.invalid/...`。少了 fallback，那些
  //  请求会被当成图片回一段 SVG，前端拿到的是 `Unexpected token '<'`，正文页直接
  //  显示「读不到这一章」。
  let n = 0;
  await page.route(/example\.invalid|^https?:\/\/(?!localhost|127\.)/i, (route) => {
    if (route.request().resourceType() !== "image") return route.fallback();
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: cover(n++) });
  });

  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  if (wait) await page.waitForSelector(wait, { timeout: 15_000 });
  //  等字体真正上屏。缺了这一步，偶尔会截到字体回退时的那一帧。
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  await page.screenshot({ path: `${OUT}/${file}.png` });
  console.log(`  ${OUT}/${file}.png`);
  await context.close();
}

const SHOTS = [
  { file: "shelf", path: "/web", viewport: PHONE, wait: "text=夜航船记" },
  { file: "read", path: "/web/read/k1", viewport: PHONE, wait: "text=江风渐起" },
  { file: "admin", path: "/admin/sources", viewport: DESKTOP, wait: "text=shuyuan-a.json" },
];

const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });
try {
  for (const shot of SHOTS) {
    for (const dark of [false, true]) {
      await shoot(browser, { ...shot, dark, file: `${shot.file}-${dark ? "dark" : "light"}` });
    }
  }
} catch (err) {
  console.error(`截图失败：${err.message}`);
  await browser.close();
  exit(1);
}
await browser.close();

//  一张索引，省得看的人去数目录里有什么。
await writeFile(
  `${OUT}/README.md`,
  [
    "# 界面截图",
    "",
    "`scripts/shots.mjs` 自动生成，**不要手改** —— 下次发版会被覆盖。",
    "",
    "后端是假的（脚本里的常量），所以同样的代码永远截出同样的图：",
    "只有界面真的改了，这个目录才会有 diff。",
    "",
    ...SHOTS.map((s) => `- \`${s.file}-light.png\` / \`${s.file}-dark.png\` — ${s.path}`),
    "",
  ].join("\n"),
);
console.log("完成");
