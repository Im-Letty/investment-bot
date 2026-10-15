(function () {
  'use strict';
  function init() {
    var sources = document.getElementById('kk-receipt-sources');
    var album = document.getElementById('ocr-album-file');
    var nativeCamera = document.getElementById('ocr-file');
    var dialog = document.getElementById('kk-receipt-camera-dialog');
    var video = document.getElementById('kk-receipt-video');
    var capture = document.getElementById('kk-receipt-capture');
    var status = document.getElementById('kk-receipt-camera-status');
    if (!sources || !album || !nativeCamera || !dialog || !video || !capture || !status) return;
    var stream = null, generation = 0, capturing = false;
    function text(key) { return typeof window.kkT === 'function' ? window.kkT(key) : ''; }
    function message(key) { status.setAttribute('data-i18n', key); status.textContent = text(key); }
    function stopTracks(media) {
      if (media) media.getTracks().forEach(function (track) { track.stop(); });
    }
    function stopStream() {
      var old = stream; stream = null;
      stopTracks(old); video.srcObject = null; capture.disabled = true;
    }
    function cleanup() { generation++; capturing = false; stopStream(); }
    function closeCamera() {
      cleanup();
      if (dialog.open) dialog.close();
      var summary = sources.querySelector('summary');
      if (summary) summary.focus({preventScroll: true});
    }
    function pick(input) {
      closeCamera(); sources.open = false;
      input.value = ''; input.click();
    }
    function upload(file) {
      if (file && typeof window.kkOcrUpload === 'function') window.kkOcrUpload(file);
    }
    [album, nativeCamera].forEach(function (input) {
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        input.value = ''; upload(file);
      });
    });
    document.getElementById('kk-receipt-album').addEventListener('click', function () { pick(album); });
    document.getElementById('kk-receipt-camera-album').addEventListener('click', function () { pick(album); });
    document.getElementById('kk-receipt-native-camera').addEventListener('click', function () { pick(nativeCamera); });
    document.getElementById('kk-receipt-camera-close').addEventListener('click', closeCamera);
    function unavailable() { stopStream(); message('kk_receipt_camera_unavailable'); }
    document.getElementById('kk-receipt-camera').addEventListener('click', function () {
      sources.open = false;
      if (typeof dialog.showModal !== 'function') { pick(nativeCamera); return; }
      cleanup(); var ticket = generation;
      message('kk_receipt_camera_starting'); dialog.showModal();
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') { unavailable(); return; }
      // Only an explicit camera-button click requests a video stream; no microphone.
      Promise.resolve().then(function () {
        if (ticket !== generation || !dialog.open) return null;
        return navigator.mediaDevices.getUserMedia({audio: false, video: {facingMode: {ideal: 'environment'}, width: {ideal: 1920}, height: {ideal: 1080}}});
      }).then(function (media) {
        if (!media) return;
        if (ticket !== generation || !dialog.open) { stopTracks(media); return; }
        stream = media; video.srcObject = media;
        media.getTracks().forEach(function (track) {
          track.addEventListener('ended', function () { if (stream === media) unavailable(); });
        });
        return video.play();
      }).catch(function () { if (ticket === generation && dialog.open) unavailable(); });
    });
    video.addEventListener('loadeddata', function () {
      if (!dialog.open || !stream || capturing || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
      capture.disabled = false; message('kk_receipt_camera_ready');
    });
    capture.addEventListener('click', function () {
      if (!dialog.open || !stream || capturing || capture.disabled || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
      var ticket = generation, canvas = document.createElement('canvas');
      var scale = Math.min(1, 2048 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      capturing = true; capture.disabled = true;
      try {
        var context = canvas.getContext('2d');
        if (!context) throw new Error('capture_unavailable');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        stopStream(); message('kk_receipt_camera_preparing');
        canvas.toBlob(function (blob) {
          canvas.width = canvas.height = 1;
          if (ticket !== generation || !dialog.open || !capturing) return;
          if (!blob) { capturing = false; message('kk_receipt_capture_failed'); return; }
          var photo;
          try { photo = new File([blob], 'receipt-photo.jpg', {type: 'image/jpeg', lastModified: Date.now()}); }
          catch (ignore) { capturing = false; message('kk_receipt_capture_failed'); return; }
          closeCamera(); upload(photo);
        }, 'image/jpeg', 0.92);
      } catch (ignore) {
        canvas.width = canvas.height = 1; capturing = false;
        stopStream(); message('kk_receipt_capture_failed');
      }
    });
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); closeCamera(); });
    dialog.addEventListener('close', cleanup);
    window.addEventListener('pagehide', closeCamera);
    document.addEventListener('visibilitychange', function () { if (document.hidden) closeCamera(); });
    // A MyPage tab or overlay may hide the iframe without a page navigation.
    try {
      var frame = window.frameElement, pane = frame && frame.closest('.kb-pane');
      var page = pane && pane.closest('#myPageOv');
      if (page && typeof MutationObserver === 'function') {
        var parentVisibility = new MutationObserver(function () {
          if (dialog.open && (!page.classList.contains('open') || !pane.classList.contains('on'))) closeCamera();
        });
        parentVisibility.observe(page, {attributes: true, attributeFilter: ['class']});
        parentVisibility.observe(pane, {attributes: true, attributeFilter: ['class']});
      }
    } catch (ignore) { /* Native page lifecycle and intersection checks remain. */ }
    if (typeof IntersectionObserver === 'function') {
      new IntersectionObserver(function (entries) {
        if (dialog.open && entries.some(function (entry) { return !entry.isIntersecting; })) closeCamera();
      }).observe(document.documentElement);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
