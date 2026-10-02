(function () {
  "use strict";
  var ZXF = window.ZXF;
  if (!ZXF) return;

  ZXF.api = {
    BASE: '',

    // ========== 通用 fetch 封装 ==========
    _fetch: async function (path, options) {
      try {
        var url = ZXF.api.BASE + path;
        var res = await fetch(url, options);
        if (!res.ok) {
          var errData = null;
          try { errData = await res.json(); } catch (e) {}
          return { error: errData ? errData.error : 'http_' + res.status, status: res.status };
        }
        return await res.json();
      } catch (e) {
        return { error: 'network', message: e.message };
      }
    },

    _get: function (path) {
      return ZXF.api._fetch(path, { method: 'GET' });
    },

    _post: function (path, body) {
      return ZXF.api._fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    },

    _put: function (path, body) {
      return ZXF.api._fetch(path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    },

    // ========== 昵称 ==========
    getOrCreateNickname: async function () {
      var storedUserId = localStorage.getItem('zxf_user_id');
      var storedNickname = localStorage.getItem('zxf_nickname');

      if (storedUserId && storedNickname) {
        // 验证已有昵称
        var result = await ZXF.api._get('/api/nickname?userId=' + encodeURIComponent(storedUserId));
        if (result && !result.error) {
          ZXF.userId = result.userId;
          ZXF.nickname = result.nickname;
          return { userId: result.userId, nickname: result.nickname };
        }
        // 无效则清除旧数据，重新分配
        localStorage.removeItem('zxf_user_id');
        localStorage.removeItem('zxf_nickname');
      }

      // 分配新昵称
      var createResult = await ZXF.api._post('/api/nickname');
      if (createResult && !createResult.error) {
        ZXF.userId = createResult.userId;
        ZXF.nickname = createResult.nickname;
        localStorage.setItem('zxf_user_id', createResult.userId);
        localStorage.setItem('zxf_nickname', createResult.nickname);
        return { userId: createResult.userId, nickname: createResult.nickname };
      }
      return { error: 'nickname_failed' };
    },

    // ========== 排行榜 ==========
    submitScore: async function (userId, score, modifiersUsed, pkModeOverride) {
      return ZXF.api._post('/api/leaderboard', {
        userId: userId,
        score: score,
        modifiersUsed: modifiersUsed || false,
        pkMode: pkModeOverride === true || (ZXF.pk && ZXF.pk.mode === 'racing')
      });
    },

    getLeaderboard: async function (top, offset, pureOnly) {
      top = top || 20;
      offset = offset || 0;
      var pure = pureOnly !== false;
      return ZXF.api._get('/api/leaderboard?top=' + top + '&offset=' + offset + '&pure=' + pure);
    },

    // ========== PK 匹配 ==========
    joinPKQueue: async function (userId) {
      return ZXF.api._post('/api/pk/matchmaking', { userId: userId });
    },

    joinFriendPK: async function (userId, friendUserId) {
      return ZXF.api._post('/api/pk/matchmaking', { userId: userId, friendUserId: friendUserId });
    },

    respondFriendPK: async function (userId, matchId, action) {
      return ZXF.api._post('/api/pk/matchmaking', {
        userId: userId,
        matchId: matchId,
        action: action
      });
    },

    pollMatchStatus: async function (userId) {
      return ZXF.api._get('/api/pk/matchmaking?userId=' + encodeURIComponent(userId));
    },

    cancelPKQueue: async function (userId) {
      return ZXF.api._post('/api/pk/matchmaking?cancel=1', { userId: userId });
    },

    // ========== 用户资料 ==========
    getProfile: async function (userId) {
      return ZXF.api._get('/api/user/profile?userId=' + encodeURIComponent(userId));
    },

    updateNickname: async function (userId, newNickname) {
      return ZXF.api._put('/api/user/profile', { userId: userId, newNickname: newNickname });
    },

    // ========== 好友 ==========
    searchUser: async function (friendUserId) {
      return ZXF.api._get('/api/friends/add?friendUserId=' + encodeURIComponent(friendUserId));
    },

    addFriend: async function (userId, friendUserId) {
      return ZXF.api._post('/api/friends/add', { userId: userId, friendUserId: friendUserId });
    },

    getFriendsList: async function (userId) {
      return ZXF.api._get('/api/friends/list?userId=' + encodeURIComponent(userId));
    },

    removeFriend: async function (userId, friendUserId) {
      return ZXF.api._post('/api/friends/list', { userId: userId, friendUserId: friendUserId });
    },

    // ========== 在线状态 ==========
    heartbeat: async function (userId) {
      var availableForPK = ZXF.phase !== 'playing' &&
        (ZXF.phase === 'ready' || ZXF.phase === 'gameover') &&
        ZXF.pk &&
        ZXF.pk.mode === 'solo';
      return ZXF.api._get(
        '/api/friends/online?ping=1&userId=' + encodeURIComponent(userId) +
        '&availableForPK=' + (availableForPK ? '1' : '0') +
        '&phase=' + encodeURIComponent(ZXF.phase || '') +
        '&pkMode=' + encodeURIComponent((ZXF.pk && ZXF.pk.mode) || '')
      );
    },

    getOnlineStatus: async function (friendIds) {
      return ZXF.api._get('/api/friends/online?ids=' + encodeURIComponent(friendIds.join(',')));
    },

    // ========== PK 同步 ==========
    syncPKProgress: async function (userId, matchId, progress) {
      return ZXF.api._post('/api/pk/sync', {
        userId: userId,
        matchId: matchId,
        score: progress.score,
        distance: progress.distance,
        speed: progress.speed,
        alive: progress.alive,
        finished: progress.finished
      });
    },

    getOpponentProgress: async function (matchId, userId) {
      return ZXF.api._get(
        '/api/pk/sync?matchId=' + encodeURIComponent(matchId) +
        '&userId=' + encodeURIComponent(userId)
      );
    }
  };
})();
