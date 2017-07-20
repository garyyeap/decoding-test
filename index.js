var url = new Url().query;
var mpd = url.manifest;
var testRepIndex = url.rep;
var from = url.from;
var to = url.to;
var licenseServer = url.drm;
var docP = window.fetch(mpd).then(res => res.text()).then(str => new window.DOMParser().parseFromString(str, 'text/xml'));
var videoEl = document.getElementById('video');
var mse = new window.MediaSource();

var iso8601ToSec = (iso8601) => {
  var reptms = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+\.\d+)S)?$/;
  var hours = 0, minutes = 0, seconds = 0, totalseconds;

  if (reptms.test(iso8601)) {
    var matches = reptms.exec(iso8601);
    if (matches[1]) hours = Number(matches[1]);
    if (matches[2]) minutes = Number(matches[2]);
    if (matches[3]) seconds = Number(matches[3]);
    return Math.ceil(hours * 3600  + minutes * 60 + seconds);
  }
}

var getVideoInfo = (doc) => {
  var arr = mpd.split('/');
  var path = arr.splice(0, arr.length - 1).join('/') + '/';
  var duration = iso8601ToSec(doc.getElementsByTagName('Period')[0].getAttribute('duration'));
  var adaptationSet = doc.getElementsByTagName('AdaptationSet')[0];
  var segmentTemplate = adaptationSet.getElementsByTagName('SegmentTemplate')[0];
  var representation = adaptationSet.getElementsByTagName('Representation')[testRepIndex];
  var totalSegments = Math.ceil(duration / (segmentTemplate.getAttribute('duration') / segmentTemplate.getAttribute('timescale')));
  var repId = representation.id;

  return {
    adaptationSet: adaptationSet,
    segmentTemplate: segmentTemplate,
    representation: representation,
    totalSegments: totalSegments,
    codecs: representation.getAttribute('mimeType') + '; codecs="' + representation.getAttribute('codecs') + '"',
    path: path + segmentTemplate.getAttribute('initialization').replace('$RepresentationID$', repId).replace('init.mp4', '')
  }
};

var drmSetup = (contentType) => {
  var config = [{
    videoCapabilities: [{
      contentType: contentType
    }]
  }];

  return window.navigator.requestMediaKeySystemAccess('com.widevine.alpha', config).then((keySystemAccess) => {
    return keySystemAccess.createMediaKeys();
  }, (e) => { console.log(e); }).then((createdMediaKeys) => {
    return videoEl.setMediaKeys(createdMediaKeys);
  });
};

var networkErrorHandler = (e) => {
  window.onNetworkError && window.onNetworkError(e);
};

var initFirstVideo = async (doc) => {

  var info = getVideoInfo(doc);
  var initVideoUrl = info.path + 'init.mp4';

  try {
    response = await window.fetch(initVideoUrl);

    if (!response.ok) {
      throw new Error('Network error: status(' + response.status + '), ' + 'url(' + response.url + ')');
    }

    response = await response.arrayBuffer();
  } catch (e) {
    return Promise.reject(e);
  }

  await drmSetup(info.codecs);

  try {
    info.sourceBuffer = mse.addSourceBuffer(info.codecs);
    info.sourceBuffer.appendBuffer(response);

    return Promise.resolve(info);
  } catch (e) {
    return Promise.reject(e);
  }
};

var appendSegment = (index) => {
  return async (info) => {
    var url = info.path + index + '.m4s';
    var response;

    try {
      response = await window.fetch(url);

      if (!response.ok) {
        throw new Error('Network error: status(' + response.status + '), ' + 'url(' + response.url + ')');
      }

      response = await response.arrayBuffer();
    } catch (e) {
      return Promise.reject(e);
    }

    try {
      info.sourceBuffer.appendBuffer(response);
      return Promise.resolve(info);
    } catch (e) {
      return Promise.reject(e);
    }
  }
};

var generateLicense = (message) => {
  return window.fetch(licenseServer, {method: 'post', body: message});
};

var appendSegments = async (info) => {
  var len = to || info.totalSegments;

  for (var i = from || 1; i <= len; i++) {
    try {
      info = await appendSegment(i)(info);
      console.log('success with segment ' + i);
    } catch (e) {
      console.log(e.message);
      console.log('error with segment ' + i);
      break;
    }
  }
};

videoEl.src = window.URL.createObjectURL(mse);
mse.addEventListener('sourceopen', (e) => {
  docP.then(initFirstVideo).then(appendSegments);
});

videoEl.addEventListener('encrypted', (e) => {
  var session = videoEl.mediaKeys.createSession();

  session.addEventListener('message', (e2) => {
    generateLicense(e2.message).then(res => res.arrayBuffer()).then((buffer) => {
      e2.target.update(buffer);
    });
  });

  session.generateRequest(e.initDataType, e.initData);
});
