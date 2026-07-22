// Injected as WKUserScript before any page loads.
// Recreates the window.rmp API from preload.js via WKWebView message handlers.
enum JSPreload {
    static let source = """
(function () {
  'use strict';
  var _callbacks = {};
  var _listeners = {};
  var _id = 0;

  function invoke(method, args) {
    return new Promise(function (resolve, reject) {
      var id = 'cb_' + (_id++);
      _callbacks[id] = { resolve: resolve, reject: reject };
      window.webkit.messageHandlers.rmpInvoke.postMessage(
        { method: method, args: (args !== undefined ? args : null), id: id }
      );
    });
  }

  function send(method, args) {
    window.webkit.messageHandlers.rmpSend.postMessage(
      { method: method, args: (args !== undefined ? args : null) }
    );
  }

  window.rmp = {
    read:          function ()        { return invoke('storage:read'); },
    getGeometry:   function ()        { return invoke('window:get-geometry'); },
    write:         function (d)       { return invoke('storage:write', d); },
    expand:        function (h)       { return invoke('window:expand', h); },
    collapse:      function ()        { return invoke('window:collapse'); },
    setHeight:     function (h)       { return invoke('window:set-height', h); },
    pointerOverNotch: function ()     { return invoke('window:pointer-over-notch'); },
    refreshHover:  function ()        { return invoke('window:refresh-hover'); },
    setNotchHoverSuspended: function (v) { send('window:notch-hover-suspended', !!v); },
    restartApp:    function ()        { return invoke('app:restart'); },
    ignoreMouse:   function (v)       { send('window:ignore-mouse', v); },
    bringToFront:  function ()        { send('window:bring-front'); },
    makeKey:       function ()        { send('panel:makeKey'); },
    exportJson:    function ()        { return invoke('export:json'); },
    exportCsv:     function ()        { return invoke('export:csv'); },
    exportTxt:     function (text)    { return invoke('export:txt', text); },
    copyToClipboard:function (text)   { return invoke('clipboard:write', text); },
    notify:        function (payload) { return invoke('notification:show', payload); },
    confetti:      function ()        { send('keyboard:confetti'); },
    openDataFolder:function ()        { return invoke('data:openFolder'); },
    openPopup:     function (v, tid)  { return invoke('popup:open', { view: v, taskId: tid || null }); },
    closePopup:    function ()        { return invoke('popup:close'); },
    resizePopup:   function (h)       { return invoke('popup:resize', h); },
    commitPopup:   function ()        { return invoke('popup:commit'); },
    moveWindow:    function (dx, dy)  { send('window:move', { dx: dx, dy: dy }); },
    setTrayTitle:  function (t)       { send('tray:setTitle', t); },

    on: function (ch, fn) {
      var allowed = ['storage:changed','notch:pulse','notch:geometry','notch:hover-enter','notch:hover-leave',
                     'shortcut:toggle','sheet:open','panel:reopen','panel:collapse-instant','popup:dismissed','app:resign-active'];
      if (allowed.indexOf(ch) !== -1) {
        if (!_listeners[ch]) _listeners[ch] = [];
        _listeners[ch].push(fn);
      }
    },
    off: function (ch, fn) {
      if (_listeners[ch])
        _listeners[ch] = _listeners[ch].filter(function (f) { return f !== fn; });
    },

    _resolve: function (id, result) {
      if (_callbacks[id]) { _callbacks[id].resolve(result); delete _callbacks[id]; }
    },
    _reject: function (id, err) {
      if (_callbacks[id]) { _callbacks[id].reject(new Error(err)); delete _callbacks[id]; }
    },
    _emit: function (ch) {
      var args = Array.prototype.slice.call(arguments, 1);
      if (_listeners[ch])
        _listeners[ch].forEach(function (fn) {
          fn.apply(null, args.length ? args : []);
        });
    }
  };
})();
"""
}
