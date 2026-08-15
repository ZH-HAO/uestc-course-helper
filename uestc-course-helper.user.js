// ==UserScript==
// @name         成电教学资源管理平台 刷课助手
// @name:zh-CN   成电教学资源管理平台 刷课助手
// @namespace    workbuddy.uestc-course-helper
// @version      0.2.0
// @description  自动播放+倍速、自动拉进度、视频结束自动切换下一节（适配 xgplayer / #h5player / .next_video_btn）
// @author       WorkBuddy
// @match        *://resource.uestc.edu.cn/*
// @match        *://*.uestc.edu.cn/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-end
// ==/UserScript==
/*
 * ===================== 安装说明 =====================
 * 1. Edge 安装 Tampermonkey（油猴）扩展；
 * 2. 把本文件拖进 Edge，或点击 Tampermonkey 图标 -> 添加新脚本 -> 全选覆盖 -> Ctrl+S；
 * 3. 打开课程页面刷新即可看到右下角浮动面板。

 * 已针对成电平台（resource.uestc.edu.cn）分析源码后定制：
 *   - 播放器为 xgplayer，容器 #h5player，普通 <video> 标签（顶层页面，无 iframe）
 *   - 播放完的“下一个学习内容”按钮 = div.video_btn.next_video_btn（在 .xgplayer-replay 内）
 *   - 完成判定：服务端根据上报的 currentTime 计算 studyProcess，>=100 即完成

 * 平台行为记录（重要）：
 *   - 拖拽进度、倍速操作都会被记录到后端 reqVideoBehaviorRecord
 *   - 本课程 allowed_double_speed=false（倍速 UI 上限 2x）、allowed_drag=true（允许拖进度）
 *   → 建议倍速不要超过 2x；拉进度在“允许拖进度”的课程上才安全
 *   → 拉到末尾后脚本会让视频再播完最后 1~2 秒，触发 ended 使服务端判定完成
 * ===================================================
 */

(function () {
  'use strict';

  if (window.__UESTC_COURSE_HELPER__) return;
  window.__UESTC_COURSE_HELPER__ = true;

  const isTop = (() => {
    try { return window.self === window.top; } catch (e) { return false; }
  })();
  const MSG_TAG = 'UESTC_HELPER';

  // ---------------- 配置（持久化） ----------------
  const CFG = {
    speed: Number(GM_getValue('speed', 2)) || 2,
    jumpToEnd: !!GM_getValue('jumpToEnd', false),
    autoNext: !!GM_getValue('autoNext', true),
    autoPlay: true,
  };
  const SPEEDS = [1, 1.25, 1.5, 2, 4, 8, 16];
  const MAX_SAFE_SPEED = 2; // 平台倍速上限（allowed_double_speed=false）
  const save = (k) => GM_setValue(k, CFG[k]);

  // ---------------- 通用小工具 ----------------
  function fmt(s) {
    s = Math.max(0, Math.floor(s || 0));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function isDisabled(el) {
    return !!el.disabled || el.getAttribute('aria-disabled') === 'true' ||
      el.classList.contains('disabled') || el.classList.contains('is-disabled');
  }

  // ---------------- Toast 提示 ----------------
  let toastEl = null;
  function toast(msg, ms) {
    try {
      if (!isTop) return;
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.style.cssText =
          'position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:2147483647;' +
          'background:rgba(20,20,28,.92);color:#7fd1ff;font:13px/1.6 "Microsoft YaHei",sans-serif;' +
          'padding:8px 16px;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.35);' +
          'pointer-events:none;opacity:0;transition:opacity .25s;max-width:80vw;';
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = msg;
      toastEl.style.opacity = '1';
      clearTimeout(toastEl._t);
      toastEl._t = setTimeout(() => { toastEl.style.opacity = '0'; }, ms || 2200);
    } catch (e) { /* ignore */ }
  }

  // ---------------- 查找并点击“下一节” ----------------
  const NEXT_KEYWORDS = [
    '下一个学习内容', '下一节', '下一课', '下一集', '下一章', '下一讲', '下一题', '下一小节', '下一段',
    '下一个', '下一步', '继续学习', '继续上课', '继续观看', '进入下一节', '完成本节',
    '已完成，继续', '播放下一集', '切换下一集',
  ];
  // 优先选择器：成电平台播放完毕后的“下一个学习内容”按钮
  const NEXT_SELECTORS = [
    '.next_video_btn', '.video_btn.next_video_btn',
    '.next', '#next', '#nextBtn', '#nextButton', '.next-btn', '.nextBtn', '.next-button',
    '.btn-next', '#btnNext', '.course-next', '.video-next', '.nextSection', '.nextChapter',
    '[data-role="next"]', '[data-type="next"]', '.el-icon-d-arrow-right',
  ];

  function findAndClickNext() {
    // 策略 0：成电平台专用按钮（必须先于通用文本匹配，避免误点“重播”）
    for (const sel of ['.next_video_btn', '.video_btn.next_video_btn']) {
      let list;
      try { list = document.querySelectorAll(sel); } catch (e) { continue; }
      for (const el of list) {
        if (isDisabled(el) || !isVisible(el)) continue;
        if (el.classList.contains('replay_video_btn')) continue; // 绝不点重播
        el.click();
        return true;
      }
    }
    // 策略 1：按钮 / 链接文本含关键词（跳过重播按钮）
    const clickables = document.querySelectorAll('button, a, [role="button"], .btn, [class*="btn" i]');
    for (const el of clickables) {
      if (isDisabled(el) || !isVisible(el)) continue;
      if (el.classList.contains('replay_video_btn')) continue;
      const t = (el.innerText || el.textContent || '').trim();
      if (t && t.length <= 30 && NEXT_KEYWORDS.some((k) => t.indexOf(k) !== -1)) {
        el.click();
        return true;
      }
    }
    // 策略 2：常见 class / id 选择器
    for (const sel of NEXT_SELECTORS) {
      let list;
      try { list = document.querySelectorAll(sel); } catch (e) { continue; }
      for (const el of list) {
        if (isDisabled(el) || !isVisible(el)) continue;
        if (el.classList.contains('replay_video_btn')) continue;
        el.click();
        return true;
      }
    }
    // 策略 3：任意可点击元素且文本正好是关键词
    const generic = document.querySelectorAll('div, span, li, td, em, i, p');
    for (const el of generic) {
      if (!isVisible(el)) continue;
      if (el.classList.contains('replay_video_btn')) continue;
      const t = (el.innerText || el.textContent || '').trim();
      if (t && t.length <= 12 && NEXT_KEYWORDS.some((k) => t === k) &&
        getComputedStyle(el).cursor === 'pointer') {
        el.click();
        return true;
      }
    }
    return false;
  }

  // 播放结束后的切节：带重试，等平台渲染“下一个学习内容”按钮
  function clickNextWithRetry(attempts) {
    attempts = attempts || 0;
    if (!CFG.autoNext) return;
    if (findAndClickNext()) return;
    if (attempts < 5) {
      setTimeout(() => clickNextWithRetry(attempts + 1), 1000);
    } else if (isTop) {
      toast('未找到“下一个学习内容”按钮，请手动点击');
    }
  }

  // ---------------- 视频处理 ----------------
  function setupVideo(video) {
    if (video.__ch) return;
    video.__ch = true;

    video.muted = true; // 浏览器通常允许静音自动播放
    try { video.playbackRate = CFG.speed; } catch (e) { /* ignore */ }

    const enforce = () => {
      try {
        if (video.playbackRate !== CFG.speed) video.playbackRate = CFG.speed;
      } catch (e) { /* ignore */ }
      // 拉进度：跳到末尾前 1 秒，再继续播放，让平台上报 currentTime→studyProcess 达标
      if (CFG.jumpToEnd && video.duration && video.duration > 30 &&
        video.currentTime < video.duration - 5) {
        const now = Date.now();
        if (!video.__jumpedAt || now - video.__jumpedAt > 8000) {
          video.__jumpedAt = now;
          try { video.currentTime = Math.max(video.duration - 1, 0); } catch (e) { /* ignore */ }
          toast('⏩ 已拉进度至末尾');
          video.play().catch(() => { /* ignore */ });
        }
      }
    };
    setInterval(enforce, 800);

    video.addEventListener('play', enforce);
    video.addEventListener('ratechange', enforce);
    video.addEventListener('loadedmetadata', () => {
      video.__jumpedAt = 0;
      if (CFG.autoPlay && video.paused) video.play().catch(() => { /* ignore */ });
    });
    video.addEventListener('loadstart', () => { video.__jumpedAt = 0; });

    let endedFired = false;
    const fireEnd = () => {
      if (endedFired) return;
      endedFired = true;
      onVideoEnded(video);
    };
    video.addEventListener('ended', fireEnd);
    video.addEventListener('timeupdate', () => {
      if (video.duration && video.currentTime >= video.duration - 0.8) fireEnd();
    });
    video.addEventListener('play', () => { endedFired = false; });

    // iframe 内的播放器把状态上报给顶层（成电当前是顶层页面，预留兼容）
    if (!isTop) {
      setInterval(() => {
        if (video.duration) {
          try {
            window.top.postMessage({ __ch: MSG_TAG, type: 'status', cur: video.currentTime, dur: video.duration }, '*');
          } catch (e) { /* ignore */ }
        }
      }, 2000);
    }
  }

  function onVideoEnded(video) {
    if (!CFG.autoNext) return;
    // 只有主播放器结束才自动切节（避免被隐藏的预览视频误触发）
    if (!isVisible(video) && video.paused) {
      toast('检测到视频结束（非当前可见播放器），跳过自动切节');
      return;
    }
    toast('🎬 视频结束，准备切换下一节');
    // 稍等平台上报学习时长后再切，避免竞态；随后带重试点“下一个学习内容”
    setTimeout(() => clickNextWithRetry(0), 1000);
  }

  // ---------------- 顶层：面板 + 消息处理 ----------------
  let speedText = null, jumpBtn = null, nextBtn = null, statusText = null;
  let lastStatus = null;

  function btnText(t) {
    const b = document.createElement('button');
    b.textContent = t;
    b.style.cssText =
      'min-width:26px;height:22px;font-size:12px;line-height:1;border-radius:4px;' +
      'border:1px solid #555;background:#333;color:#eee;cursor:pointer;';
    return b;
  }
  function mkToggle(get, onChange) {
    const b = document.createElement('button');
    b.style.cssText =
      'min-width:52px;font-size:12px;padding:2px 8px;border-radius:4px;' +
      'border:1px solid #555;background:#333;color:#eee;cursor:pointer;';
    const paint = () => {
      const on = get();
      b.textContent = on ? '开' : '关';
      b.style.borderColor = on ? '#3ddc84' : '#888';
      b.style.color = on ? '#3ddc84' : '#999';
    };
    paint();
    b.addEventListener('click', () => { onChange(!get()); paint(); });
    return b;
  }
  function addRow(p, label, control) {
    const r = document.createElement('div');
    r.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:3px 0;';
    const l = document.createElement('span');
    l.textContent = label;
    l.style.cssText = 'color:#bbb;';
    r.appendChild(l);
    r.appendChild(control);
    p.appendChild(r);
  }

  function adjustSpeed(delta) {
    let i = SPEEDS.indexOf(CFG.speed);
    if (i < 0) i = 1;
    i = Math.max(0, Math.min(SPEEDS.length - 1, i + delta));
    CFG.speed = SPEEDS[i];
    save('speed');
    document.querySelectorAll('video').forEach((v) => { try { v.playbackRate = CFG.speed; } catch (e) { /* ignore */ } });
    if (speedText) speedText.textContent = CFG.speed + 'x';
    if (CFG.speed > MAX_SAFE_SPEED) {
      toast('⚠ 该课程倍速上限 ' + MAX_SAFE_SPEED + 'x，超过可能被后台记录异常');
    } else {
      toast('倍速：' + CFG.speed + 'x');
    }
  }

  function createPanel() {
    if (document.getElementById('__uestc_helper_panel')) return;
    const p = document.createElement('div');
    p.id = '__uestc_helper_panel';
    p.style.cssText =
      'position:fixed;right:12px;bottom:12px;z-index:2147483647;' +
      'background:rgba(30,30,40,.94);color:#eee;font:12px/1.7 "Microsoft YaHei",Arial,sans-serif;' +
      'border:1px solid #444;border-radius:8px;padding:10px 12px;width:204px;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.35);user-select:none;';

    const title = document.createElement('div');
    title.textContent = '刷课助手';
    title.style.cssText = 'font-weight:bold;margin-bottom:6px;color:#7fd1ff;';
    p.appendChild(title);

    // 倍速行
    const spWrap = document.createElement('span');
    spWrap.style.cssText = 'display:flex;align-items:center;gap:4px;';
    const minus = btnText('−');
    const plus = btnText('+');
    speedText = document.createElement('span');
    speedText.style.cssText = 'display:inline-block;min-width:40px;text-align:center;color:#7fd1ff;';
    minus.addEventListener('click', () => adjustSpeed(-1));
    plus.addEventListener('click', () => adjustSpeed(1));
    spWrap.appendChild(minus);
    spWrap.appendChild(speedText);
    spWrap.appendChild(plus);
    addRow(p, '倍速', spWrap);

    // 拉进度行
    jumpBtn = mkToggle(() => CFG.jumpToEnd, (v) => {
      CFG.jumpToEnd = v; save('jumpToEnd');
      toast('拉进度：' + (v ? '开' : '关'));
    });
    addRow(p, '拉进度', jumpBtn);

    // 自动切节行
    nextBtn = mkToggle(() => CFG.autoNext, (v) => {
      CFG.autoNext = v; save('autoNext');
      toast('自动切节：' + (v ? '开' : '关'));
    });
    addRow(p, '自动切节', nextBtn);

    // 状态行
    statusText = document.createElement('span');
    statusText.style.cssText = 'color:#9ccc65;';
    addRow(p, '状态', statusText);

    // 调试行
    const tb = document.createElement('button');
    tb.textContent = '点下一节';
    tb.style.cssText =
      'min-width:52px;font-size:12px;padding:2px 8px;border-radius:4px;' +
      'border:1px solid #555;background:#333;color:#eee;cursor:pointer;';
    tb.addEventListener('click', () => {
      const ok = findAndClickNext();
      toast(ok ? '已尝试点击下一节' : '未找到下一节按钮');
    });
    addRow(p, '调试', tb);

    document.body.appendChild(p);
    updateStatus();
  }

  function updateStatus() {
    const v = document.querySelector('#h5player video, .video_box video, video');
    if (v && v.duration) {
      statusText.textContent = fmt(v.currentTime) + ' / ' + fmt(v.duration);
    } else if (lastStatus) {
      statusText.textContent = fmt(lastStatus.cur) + ' / ' + fmt(lastStatus.dur) + ' (子窗口)';
    } else {
      statusText.textContent = '未检测到视频';
    }
  }

  function onMessage(e) {
    const d = e.data;
    if (!d || d.__ch !== MSG_TAG) return;
    if (d.type === 'video-ended') {
      clickNextWithRetry(0);
    } else if (d.type === 'status') {
      lastStatus = { cur: d.cur, dur: d.dur };
    }
  }

  // ---------------- 启动 ----------------
  function boot() {
    if (isTop) {
      // 部分页面切节会弹 confirm 确认框，自动点确定
      try { unsafeWindow.confirm = function () { return true; }; } catch (e) { /* ignore */ }
    }

    const scan = () => document.querySelectorAll('video').forEach(setupVideo);
    scan();
    if (document.readyState !== 'complete') {
      window.addEventListener('load', scan);
    }
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });

    if (isTop) {
      createPanel();
      setInterval(updateStatus, 1000);
      window.addEventListener('message', onMessage);
      document.addEventListener('keydown', (e) => {
        const t = e.target;
        if (t && /input|textarea|select/i.test(t.tagName)) return;
        if (e.key === ']') adjustSpeed(1);
        else if (e.key === '[') adjustSpeed(-1);
      });

      GM_registerMenuCommand('倍速 +', () => adjustSpeed(1));
      GM_registerMenuCommand('倍速 -', () => adjustSpeed(-1));
      GM_registerMenuCommand('切换：拉进度', () => { jumpBtn && jumpBtn.click(); });
      GM_registerMenuCommand('切换：自动切节', () => { nextBtn && nextBtn.click(); });
      GM_registerMenuCommand('调试：测试点下一节', () => {
        const ok = findAndClickNext();
        toast(ok ? '已尝试点击下一节' : '未找到下一节按钮');
      });
    }
  }

  boot();
})();
