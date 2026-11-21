"use strict";

(function initEarnBdMiniApp() {
  // User auth token kept strictly in JS memory
  let sessionToken = null;
  let activeTab = "home";
  let selectedWithdrawMethod = "bKash";
  let selectedWithdrawFilter = "all";
  let currentMonetagSession = null;
  let activeGameCleanup = null;

  const tgWebApp = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  const authGate = document.getElementById("auth-gate");
  const authGateMsg = document.getElementById("auth-gate-message");
  const retryAuthBtn = document.getElementById("retry-auth-btn");
  const appRoot = document.getElementById("app-root");
  const toastEl = document.getElementById("toast-banner");

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    setTimeout(function () {
      toastEl.hidden = true;
    }, 3200);
  }

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) {
      node.textContent = String(text);
    }
    if (className) {
      node.className = className;
    }
    return node;
  }

  function formatBdt(amount) {
    return Number(amount || 0).toFixed(2) + " BDT";
  }

  async function api(url, options) {
    const opts = Object.assign({ headers: {} }, options || {});
    if (sessionToken) {
      opts.headers["Authorization"] = "Bearer " + sessionToken;
    }
    if (opts.body && !opts.headers["Content-Type"]) {
      opts.headers["Content-Type"] = "application/json";
    }
    const res = await fetch(url, opts);
    if (res.status === 401) {
      sessionToken = null;
      appRoot.hidden = true;
      authGate.hidden = false;
      authGateMsg.textContent = "Session expired. Reopen the EARN BD Mini App inside Telegram.";
      retryAuthBtn.hidden = false;
    }
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      throw new Error(data.detail || "Request failed");
    }
    return data;
  }

  function renderEmptyState(container, text) {
    container.replaceChildren(el("p", text, "meta-text"));
  }

  function renderNotifications(container, items) {
    container.replaceChildren();
    if (!items || items.length === 0) {
      renderEmptyState(container, "No notifications yet.");
      return;
    }
    items.forEach(function (n) {
      const row = el("div", null, "list-row");
      const main = el("div", null, "list-row-main");
      main.appendChild(el("span", n.title, "list-row-title"));
      main.appendChild(el("span", n.message, "list-row-sub"));
      row.appendChild(main);
      row.appendChild(el("span", n.is_read ? "Read" : "New", n.is_read ? "meta-text" : "gold-text meta-text"));
      container.appendChild(row);
    });
  }

  function renderHistory(container, items) {
    container.replaceChildren();
    if (!items || items.length === 0) {
      renderEmptyState(container, "No earning transactions recorded yet.");
      return;
    }
    items.forEach(function (tx) {
      const row = el("div", null, "list-row");
      const main = el("div", null, "list-row-main");
      main.appendChild(el("span", tx.description || tx.type, "list-row-title"));
      main.appendChild(el("span", tx.type + " · " + tx.created_at, "list-row-sub"));
      row.appendChild(main);
      const sign = Number(tx.amount) >= 0 ? "+" : "";
      row.appendChild(
        el("span", sign + formatBdt(tx.amount), Number(tx.amount) >= 0 ? "mono-num gold-text" : "mono-num meta-text")
      );
      container.appendChild(row);
    });
  }

  async function loadHome() {
    const data = await api("/api/home");
    document.getElementById("top-user-name").textContent = data.user.display_name || "User";
    document.getElementById("top-user-balance").textContent = formatBdt(data.wallet.available_balance);

    document.getElementById("home-balance").textContent = formatBdt(data.wallet.available_balance);
    document.getElementById("home-level").textContent = "Level " + data.user.level;
    document.getElementById("home-total-earned").textContent = formatBdt(data.wallet.total_earnings);
    document.getElementById("home-today-earned").textContent = formatBdt(data.wallet.today_earnings);
    document.getElementById("home-total-refs").textContent = String(data.total_referrals);

    document.getElementById("home-bonus-streak").textContent = data.daily_bonus.streak_days + " day streak";
    document.getElementById("home-bonus-reward").textContent = formatBdt(data.daily_bonus.next_reward);
    const homeBonusBtn = document.getElementById("home-claim-bonus-btn");
    homeBonusBtn.disabled = data.daily_bonus.claimed_today;
    homeBonusBtn.textContent = data.daily_bonus.claimed_today ? "Claimed Today" : "Claim Daily Bonus";

    document.getElementById("home-unread-count").textContent = data.unread_notifications + " unread";
    renderNotifications(document.getElementById("home-notifications-list"), data.notifications);
  }

  async function handleClaimDailyBonus() {
    try {
      const res = await api("/api/earn/daily-bonus", { method: "POST" });
      showToast("Daily bonus claimed: +" + formatBdt(res.reward_amount));
      if (activeTab === "home") await loadHome();
      if (activeTab === "earn") await loadEarn();
      if (activeTab === "profile") await loadProfile();
    } catch (err) {
      showToast(err.message);
    }
  }

  function loadExternalScript(src) {
    return new Promise(function (resolve, reject) {
      if (!src || !src.startsWith("https://")) {
        reject(new Error("Invalid Monetag HTTPS SDK URL."));
        return;
      }
      const existing = document.querySelector('script[data-monetag-sdk="1"]');
      if (existing) {
        resolve();
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.dataset.monetagSdk = "1";
      s.onload = resolve;
      s.onerror = function () {
        reject(new Error("Failed to load Monetag SDK."));
      };
      document.head.appendChild(s);
    });
  }

  async function loadEarn() {
    const data = await api("/api/earn/overview");
    document.getElementById("earn-bonus-streak").textContent = "Streak: " + data.daily_bonus.streak_days;
    document.getElementById("earn-bonus-reward").textContent = formatBdt(data.daily_bonus.next_reward);
    const earnBonusBtn = document.getElementById("earn-claim-bonus-btn");
    earnBonusBtn.disabled = data.daily_bonus.claimed_today;
    earnBonusBtn.textContent = data.daily_bonus.claimed_today ? "Claimed Today" : "Claim Daily Bonus";

    const monetag = data.monetag;
    document.getElementById("monetag-quota-text").textContent =
      monetag.remaining_today + "/" + monetag.daily_limit + " left";
    const watchBtn = document.getElementById("monetag-watch-btn");
    const claimBtn = document.getElementById("monetag-claim-btn");
    const statusDesc = document.getElementById("monetag-status-desc");

    if (!monetag.is_configured) {
      statusDesc.textContent = monetag.missing_requirements.join(" ");
      watchBtn.disabled = true;
      claimBtn.hidden = true;
    } else {
      statusDesc.textContent =
        "Reward: " + formatBdt(monetag.ad_reward) + " per verified ad (Zone " + monetag.zone_id + ").";
      watchBtn.disabled = monetag.remaining_today <= 0;
      claimBtn.hidden = !currentMonetagSession;
    }

    const tasksWrap = document.getElementById("earn-tasks-list");
    tasksWrap.replaceChildren();
    if (!data.tasks || data.tasks.length === 0) {
      renderEmptyState(tasksWrap, "No active tasks configured yet.");
    } else {
      data.tasks.forEach(function (t) {
        const row = el("div", null, "list-row");
        const main = el("div", null, "list-row-main");
        main.appendChild(el("span", t.title, "list-row-title"));
        main.appendChild(
          el("span", (t.description || t.task_type) + " · +" + formatBdt(t.reward_amount), "list-row-sub")
        );
        row.appendChild(main);

        const actions = el("div", null, "list-row-right");
        if (t.target_url && t.target_url.startsWith("https://")) {
          const openBtn = el("button", "Open", "btn-secondary-sm");
          openBtn.type = "button";
          openBtn.addEventListener("click", function () {
            if (tgWebApp && t.target_url.startsWith("https://t.me/")) {
              tgWebApp.openTelegramLink(t.target_url);
            } else if (tgWebApp) {
              tgWebApp.openLink(t.target_url);
            } else {
              window.location.href = t.target_url;
            }
          });
          actions.appendChild(openBtn);
        }

        const verifyBtn = el("button", t.is_completed ? "Done" : "Verify", t.is_completed ? "btn-secondary-sm" : "btn-gold");
        verifyBtn.type = "button";
        verifyBtn.disabled = t.is_completed;
        verifyBtn.addEventListener("click", async function () {
          try {
            verifyBtn.disabled = true;
            const res = await api("/api/earn/tasks/" + t.id + "/verify", { method: "POST" });
            showToast("Verified! +" + formatBdt(res.reward_amount));
            await loadEarn();
            await loadHome();
          } catch (err) {
            verifyBtn.disabled = false;
            showToast(err.message);
          }
        });
        actions.appendChild(verifyBtn);
        row.appendChild(actions);
        tasksWrap.appendChild(row);
      });
    }

    renderHistory(document.getElementById("earn-history-list"), data.earning_history);
  }

  function closeArena() {
    if (typeof activeGameCleanup === "function") {
      activeGameCleanup();
      activeGameCleanup = null;
    }
    document.getElementById("active-game-arena").hidden = true;
    document.getElementById("arena-body").replaceChildren();
  }

  function launchReactionArena(game, session) {
    const arena = document.getElementById("active-game-arena");
    const body = document.getElementById("arena-body");
    document.getElementById("arena-title").textContent = game.title;
    body.replaceChildren();
    arena.hidden = false;

    const info = el("p", "Wait for gold, then tap! Win reward: " + formatBdt(session.reward_amount), "card-desc");
    const pad = el("button", "Wait for Gold...", "reaction-pad waiting");
    pad.type = "button";
    const resultText = el("p", "", "card-desc");
    body.appendChild(info);
    body.appendChild(pad);
    body.appendChild(resultText);

    let signalAt = 0;
    let finished = false;
    const waitMs = session.params.wait_ms || 1500;
    const timer = setTimeout(function () {
      if (finished) return;
      signalAt = performance.now();
      pad.className = "reaction-pad ready";
      pad.textContent = "TAP NOW!";
    }, waitMs);

    activeGameCleanup = function () {
      finished = true;
      clearTimeout(timer);
    };

    pad.addEventListener("click", async function () {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const reactionMs = signalAt > 0 ? Math.max(1, Math.round(performance.now() - signalAt)) : 50;
      pad.disabled = true;
      try {
        const res = await api("/api/games/" + game.id + "/submit", {
          method: "POST",
          body: JSON.stringify({
            session_token: session.session_token,
            reaction_ms: reactionMs,
          }),
        });
        resultText.textContent = res.message + (res.won ? " (+" + formatBdt(res.reward_amount) + ")" : "");
        showToast(res.message);
        await loadGames();
        await loadHome();
      } catch (err) {
        resultText.textContent = err.message;
        showToast(err.message);
      }
    });
  }

  function launchNumberGuessArena(game, session) {
    const arena = document.getElementById("active-game-arena");
    const body = document.getElementById("arena-body");
    document.getElementById("arena-title").textContent = game.title;
    body.replaceChildren();
    arena.hidden = false;

    const minNum = session.params.min_number || 1;
    const maxNum = session.params.max_number || 10;
    const maxAttempts = session.params.max_attempts || 3;

    const statusLine = el(
      "p",
      "Pick a number between " + minNum + " and " + maxNum + ". Attempts: " + maxAttempts,
      "card-desc"
    );
    const grid = el("div", null, "guess-grid");
    body.appendChild(statusLine);
    body.appendChild(grid);

    for (let n = minNum; n <= maxNum; n += 1) {
      const btn = el("button", String(n), "guess-num-btn");
      btn.type = "button";
      btn.addEventListener("click", async function () {
        btn.disabled = true;
        try {
          const res = await api("/api/games/" + game.id + "/submit", {
            method: "POST",
            body: JSON.stringify({
              session_token: session.session_token,
              guess: n,
            }),
          });
          statusLine.textContent =
            res.message +
            (res.completed
              ? res.won
                ? " +" + formatBdt(res.reward_amount)
                : ""
              : " (" + res.attempts_remaining + " attempts left)");
          if (res.completed) {
            grid.querySelectorAll("button").forEach(function (b) {
              b.disabled = true;
            });
            showToast(res.message);
            await loadGames();
            await loadHome();
          }
        } catch (err) {
          showToast(err.message);
        }
      });
      grid.appendChild(btn);
    }
  }

  async function loadGames() {
    const data = await api("/api/games");
    const list = document.getElementById("games-list");
    list.replaceChildren();

    if (!data.games || data.games.length === 0) {
      renderEmptyState(list, "No active games configured.");
    } else {
      data.games.forEach(function (g) {
        const card = el("div", null, "surface-card");
        const head = el("div", null, "card-head");
        head.appendChild(el("h3", g.title));
        head.appendChild(el("span", g.remaining_today + "/" + g.daily_limit + " plays left", "meta-text"));
        card.appendChild(head);
        card.appendChild(el("p", g.description, "card-desc"));
        card.appendChild(el("p", "Win reward: " + formatBdt(g.reward_amount), "gold-text mono-num meta-text"));
        const playBtn = el("button", g.remaining_today > 0 ? "Play Now" : "Daily Limit Reached", "btn-primary");
        playBtn.type = "button";
        playBtn.disabled = g.remaining_today <= 0;
        playBtn.addEventListener("click", async function () {
          try {
            closeArena();
            const session = await api("/api/games/" + g.id + "/start", { method: "POST" });
            if (g.game_type === "reaction") {
              launchReactionArena(g, session);
            } else {
              launchNumberGuessArena(g, session);
            }
          } catch (err) {
            showToast(err.message);
          }
        });
        card.appendChild(playBtn);
        list.appendChild(card);
      });
    }

    const hist = document.getElementById("games-history-list");
    hist.replaceChildren();
    if (!data.history || data.history.length === 0) {
      renderEmptyState(hist, "No game history yet.");
    } else {
      data.history.forEach(function (h) {
        const row = el("div", null, "list-row");
        const main = el("div", null, "list-row-main");
        main.appendChild(el("span", h.game_title, "list-row-title"));
        main.appendChild(el("span", (h.won ? "Won" : "Lost") + " · " + h.completed_at, "list-row-sub"));
        row.appendChild(main);
        row.appendChild(
          el("span", h.won ? "+" + formatBdt(h.reward_amount) : "0.00 BDT", h.won ? "gold-text mono-num" : "meta-text mono-num")
        );
        hist.appendChild(row);
      });
    }
  }

  async function loadReferrals() {
    const data = await api("/api/referrals");
    document.getElementById("refer-reward-rate").textContent = formatBdt(data.reward_per_referral) + " / invite";
    document.getElementById("refer-total-invited").textContent = String(data.total_invited);
    document.getElementById("refer-successful").textContent = String(data.successful_referrals);
    document.getElementById("refer-total-earned").textContent = formatBdt(data.total_earned_from_referrals);
    document.getElementById("refer-code-display").value = data.referral_code;
    document.getElementById("refer-link-display").value =
      data.referral_link || "Set BOT_USERNAME in .env to generate link";

    const hist = document.getElementById("refer-history-list");
    hist.replaceChildren();
    if (!data.history || data.history.length === 0) {
      renderEmptyState(hist, "No referrals yet. Share your link to invite friends.");
    } else {
      data.history.forEach(function (r) {
        const row = el("div", null, "list-row");
        const main = el("div", null, "list-row-main");
        main.appendChild(el("span", r.invited_name || r.invited_username || "Invited User", "list-row-title"));
        main.appendChild(el("span", r.status + " · " + r.created_at, "list-row-sub"));
        row.appendChild(main);
        row.appendChild(el("span", "+" + formatBdt(r.bonus_amount), "gold-text mono-num"));
        hist.appendChild(row);
      });
    }
  }

  async function loadWallet() {
    const data = await api("/api/wallet?status_filter=" + encodeURIComponent(selectedWithdrawFilter));
    document.getElementById("wallet-available").textContent = Number(data.available_balance).toFixed(2);
    document.getElementById("wallet-pending").textContent = Number(data.pending_withdrawal).toFixed(2);
    document.getElementById("wallet-withdrawn").textContent = Number(data.total_withdrawn).toFixed(2);
    document.getElementById("wallet-min-wd").textContent = "Min: " + formatBdt(data.minimum_withdrawal);

    const hist = document.getElementById("wallet-history-list");
    hist.replaceChildren();
    if (!data.withdrawals || data.withdrawals.length === 0) {
      renderEmptyState(hist, "No withdrawal requests found.");
    } else {
      data.withdrawals.forEach(function (w) {
        const row = el("div", null, "list-row");
        const main = el("div", null, "list-row-main");
        main.appendChild(el("span", w.method + " · " + w.account_number, "list-row-title"));
        main.appendChild(el("span", w.status.toUpperCase() + " · " + w.created_at, "list-row-sub"));
        row.appendChild(main);
        row.appendChild(el("span", formatBdt(w.amount), "mono-num gold-text"));
        hist.appendChild(row);
      });
    }
  }

  async function loadProfile() {
    const data = await api("/api/profile");
    const u = data.user;
    document.getElementById("profile-name").textContent = u.display_name || "User";
    document.getElementById("profile-meta").textContent = "ID #" + u.id + " · TG " + u.telegram_id + " · Level " + u.level;
    document.getElementById("profile-bio-text").textContent = u.bio || "";

    const photoImg = document.getElementById("profile-photo");
    const avatarFallback = document.getElementById("profile-avatar-fallback");
    if (u.photo_url && u.photo_url.startsWith("https://")) {
      photoImg.src = u.photo_url;
      photoImg.hidden = false;
      avatarFallback.hidden = true;
    } else {
      photoImg.hidden = true;
      avatarFallback.hidden = false;
      avatarFallback.textContent = (u.display_name || "U").charAt(0).toUpperCase();
    }

    document.getElementById("prof-balance").textContent = Number(data.stats.available_balance).toFixed(2);
    document.getElementById("prof-earned").textContent = Number(data.stats.total_earnings).toFixed(2);
    document.getElementById("prof-refs").textContent = String(data.stats.total_referrals);
    document.getElementById("prof-withdrawn").textContent = Number(data.stats.total_withdrawn).toFixed(2);

    document.getElementById("edit-display-name").value = u.display_name || "";
    document.getElementById("edit-bio").value = u.bio || "";
    document.getElementById("setting-notif").checked = Boolean(data.settings.notifications_enabled);
    document.getElementById("setting-sound").checked = Boolean(data.settings.sound_enabled);

    document.getElementById("prof-checkin-status").textContent = u.checked_in_today ? "Checked in today" : "Available";
    document.getElementById("prof-xp-line").textContent = u.xp + " XP · " + u.checkin_streak + " day streak";
    document.getElementById("prof-checkin-btn").disabled = u.checked_in_today;

    const supportWrap = document.getElementById("support-links-wrap");
    supportWrap.replaceChildren();
    if (data.support.support_username) {
      const btn = el("button", "Telegram Support: @" + data.support.support_username, "btn-secondary-sm");
      btn.type = "button";
      btn.addEventListener("click", function () {
        const url = "https://t.me/" + data.support.support_username;
        if (tgWebApp) tgWebApp.openTelegramLink(url);
        else window.location.href = url;
      });
      supportWrap.appendChild(btn);
    }
    if (data.support.support_email) {
      supportWrap.appendChild(el("p", "Email: " + data.support.support_email, "meta-text"));
    }
    if (!data.support.support_username && !data.support.support_email) {
      renderEmptyState(supportWrap, "Support contact details are not configured yet.");
    }

    const achWrap = document.getElementById("achievements-list");
    achWrap.replaceChildren();
    data.achievements.forEach(function (a) {
      const row = el("div", null, "list-row");
      const main = el("div", null, "list-row-main");
      main.appendChild(el("span", a.title, "list-row-title"));
      main.appendChild(el("span", a.description, "list-row-sub"));
      row.appendChild(main);
      row.appendChild(el("span", a.unlocked ? "Unlocked" : "Locked", a.unlocked ? "gold-text meta-text" : "meta-text"));
      achWrap.appendChild(row);
    });

    const lbWrap = document.getElementById("leaderboard-list");
    lbWrap.replaceChildren();
    if (!data.leaderboard_enabled) {
      renderEmptyState(lbWrap, "Leaderboard is currently disabled by administrator.");
    } else if (!data.leaderboard || data.leaderboard.length === 0) {
      renderEmptyState(lbWrap, "No leaderboard entries yet.");
    } else {
      data.leaderboard.forEach(function (entry) {
        const row = el("div", null, "list-row");
        const main = el("div", null, "list-row-main");
        main.appendChild(el("span", "#" + entry.rank + " · " + entry.display_name, "list-row-title"));
        main.appendChild(el("span", "Level " + entry.level, "list-row-sub"));
        row.appendChild(main);
        row.appendChild(el("span", formatBdt(entry.total_earned), "gold-text mono-num"));
        lbWrap.appendChild(row);
      });
    }

    renderNotifications(document.getElementById("profile-notifications-list"), data.notifications);
    renderHistory(document.getElementById("profile-history-list"), data.earning_history);
  }

  async function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll(".tab-view").forEach(function (sec) {
      sec.hidden = sec.id !== "view-" + tab;
    });
    document.querySelectorAll(".bottom-nav-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.nav === tab);
    });

    try {
      if (tab === "home") await loadHome();
      if (tab === "earn") await loadEarn();
      if (tab === "games") await loadGames();
      if (tab === "refer") await loadReferrals();
      if (tab === "wallet") await loadWallet();
      if (tab === "profile") await loadProfile();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function authenticateTelegram() {
    authGate.hidden = false;
    appRoot.hidden = true;
    retryAuthBtn.hidden = true;

    if (!tgWebApp || !tgWebApp.initData) {
      authGateMsg.textContent =
        "Please launch this Mini App from the official EARN BD Telegram Bot to authenticate securely.";
      return;
    }

    tgWebApp.ready();
    tgWebApp.expand();
    authGateMsg.textContent = "Verifying Telegram signature...";

    try {
      const startParam =
        tgWebApp.initDataUnsafe && tgWebApp.initDataUnsafe.start_param
          ? tgWebApp.initDataUnsafe.start_param
          : "";
      const res = await fetch("/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          init_data: tgWebApp.initData,
          start_param: startParam,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Telegram authentication failed.");
      }
      sessionToken = data.access_token;
      authGate.hidden = true;
      appRoot.hidden = false;
      await switchTab("home");
    } catch (err) {
      authGateMsg.textContent = err.message;
      retryAuthBtn.hidden = false;
    }
  }

  document.querySelectorAll("[data-nav]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      switchTab(btn.dataset.nav);
    });
  });

  document.getElementById("home-claim-bonus-btn").addEventListener("click", handleClaimDailyBonus);
  document.getElementById("earn-claim-bonus-btn").addEventListener("click", handleClaimDailyBonus);
  document.getElementById("prof-checkin-btn").addEventListener("click", handleClaimDailyBonus);
  document.getElementById("arena-close-btn").addEventListener("click", closeArena);
  retryAuthBtn.addEventListener("click", authenticateTelegram);

  document.getElementById("monetag-watch-btn").addEventListener("click", async function () {
    try {
      const session = await api("/api/earn/ads/start", { method: "POST" });
      currentMonetagSession = session;
      document.getElementById("monetag-claim-btn").hidden = false;
      await loadExternalScript(session.sdk_url);
      showToast("Monetag ad session started. Complete the ad and tap Verify & Claim.");
    } catch (err) {
      showToast(err.message);
    }
  });

  document.getElementById("monetag-claim-btn").addEventListener("click", async function () {
    if (!currentMonetagSession) return;
    try {
      const res = await api("/api/earn/ads/claim", {
        method: "POST",
        body: JSON.stringify({ session_token: currentMonetagSession.session_token }),
      });
      currentMonetagSession = null;
      showToast("Ad verified! +" + formatBdt(res.reward_amount));
      await loadEarn();
      await loadHome();
    } catch (err) {
      showToast(err.message);
    }
  });

  document.getElementById("copy-ref-btn").addEventListener("click", async function () {
    const link = document.getElementById("refer-link-display").value;
    if (!link.startsWith("https://")) {
      showToast("Referral link unavailable until BOT_USERNAME is set.");
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      showToast("Referral link copied!");
    } catch (_) {
      document.getElementById("refer-link-display").select();
      document.execCommand("copy");
      showToast("Referral link copied!");
    }
  });

  document.getElementById("share-ref-btn").addEventListener("click", function () {
    const link = document.getElementById("refer-link-display").value;
    if (!link.startsWith("https://")) {
      showToast("Referral link unavailable until BOT_USERNAME is set.");
      return;
    }
    const shareUrl =
      "https://t.me/share/url?url=" +
      encodeURIComponent(link) +
      "&text=" +
      encodeURIComponent("Join EARN BD and start earning BDT!");
    if (tgWebApp) tgWebApp.openTelegramLink(shareUrl);
    else window.location.href = shareUrl;
  });

  document.querySelectorAll(".method-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      selectedWithdrawMethod = btn.dataset.method;
      document.querySelectorAll(".method-btn").forEach(function (b) {
        b.classList.toggle("active", b.dataset.method === selectedWithdrawMethod);
      });
    });
  });

  document.querySelectorAll("[data-wd-filter]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      selectedWithdrawFilter = btn.dataset.wdFilter;
      document.querySelectorAll("[data-wd-filter]").forEach(function (b) {
        b.classList.toggle("active", b.dataset.wdFilter === selectedWithdrawFilter);
      });
      loadWallet().catch(function (err) {
        showToast(err.message);
      });
    });
  });

  document.getElementById("withdrawal-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    const account = document.getElementById("wd-account").value.trim();
    const amount = parseFloat(document.getElementById("wd-amount").value);
    try {
      const res = await api("/api/wallet/withdraw", {
        method: "POST",
        body: JSON.stringify({
          method: selectedWithdrawMethod,
          account_number: account,
          amount: amount,
        }),
      });
      e.target.reset();
      showToast(res.message);
      await loadWallet();
      await loadHome();
    } catch (err) {
      showToast(err.message);
    }
  });

  document.getElementById("profile-edit-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    try {
      await api("/api/profile", {
        method: "PUT",
        body: JSON.stringify({
          display_name: document.getElementById("edit-display-name").value.trim(),
          bio: document.getElementById("edit-bio").value.trim(),
          notifications_enabled: document.getElementById("setting-notif").checked,
          sound_enabled: document.getElementById("setting-sound").checked,
        }),
      });
      showToast("Profile updated");
      await loadProfile();
      await loadHome();
    } catch (err) {
      showToast(err.message);
    }
  });

  document.getElementById("mark-notif-read-btn").addEventListener("click", async function () {
    try {
      await api("/api/profile/notifications/read", { method: "POST" });
      showToast("Notifications marked as read");
      await loadProfile();
      await loadHome();
    } catch (err) {
      showToast(err.message);
    }
  });

  authenticateTelegram();
})();
