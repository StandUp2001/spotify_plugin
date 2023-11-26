//* Constants
const API_URL = "https://api-v2.soundcloud.com/";
const APP_LOCALE = "en";
const PLATFORM = "Soundcloud";
const PLATFORM_CLAIMTYPE = 16;
const SOUNDCLOUD_APP_VERSION = "1686222762";
const USER_AGENT_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36";
const USER_AGENT_MOBILE =
  "Mozilla/5.0 (Linux; Android 10; Pixel 6a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36";

const URL_BASE = "https://soundcloud.com";

let CLIENT_ID = "iZIs9mchVcX5lhVRyQGGAYlNPVldzAoX"; // correct as of June 2023, enable changes this to get the latest
const URL_ADDITIVE = `&app_version=${SOUNDCLOUD_APP_VERSION}&app_locale=${APP_LOCALE}`;

var config = {};

//* Source
source.enable = function (conf) {
  config = conf ?? {};
  CLIENT_ID = getClientId();
  return CLIENT_ID;
};
source.getHome = function () {
  return new QueryPager({ page: 1, page_size: 20 });
};
source.searchSuggestions = function (query) {
  const url = `${API_URL}search/queries?q=${query}&client_id=${CLIENT_ID}&limit=10&offset=0&linked_partitioning=1${URL_ADDITIVE}`;

  const resp = callUrl(url);

  /** @type {import("./types").SearchAutofillResponse} */
  const json = JSON.parse(resp.body);

  if (!json["collection"]) {
    throw new ScriptException("Could not find collection");
  }

  /** @type {{output: string; query: string}[]} */
  const collection = json["collection"];

  return collection.map((item) => item["query"]);
};
source.getSearchCapabilities = () => {
  return {
    types: [Type.Feed.Mixed], // can also do albums, playlists, channels those do not have types yet
    sorts: [],
    filters: [], // filters depend on type
  };
};
source.search = function (query, type, order, filters) {
  return new SearchPagerVideos({
    q: query,
    page: 1,
    page_size: 20,
    get_all: false,
  });
};
source.getSearchChannelContentsCapabilities = function () {
  return {
    types: [Type.Feed.Mixed],
    sorts: [Type.Order.Chronological],
    filters: [],
  };
};
source.searchChannelContent = function (
  channelUrl,
  query,
  type,
  order,
  filters
) {
  return [];
};
source.searchChannels = function (query) {
  return new SearchPagerChannels({ q: query, page: 1, page_size: 20 });
};
source.isChannelUrl = function (url) {
  // see if it matches https://soundcloud.com/nfrealmusic
  return /soundcloud\.com\/[a-zA-Z0-9-_]+\/?/.test(url);
};
source.getChannel = function (url) {
  const resp = callUrl(url);

  const html = resp.body;

  const matched = html.match(/window\.__sc_hydration = (.+);/);
  if (!matched) {
    throw new ScriptException("Could not find channel info");
  }

  /** @type {import("./types").SCHydration[]} */
  const json = JSON.parse(matched[1]);

  for (let object of json) {
    if (object.hydratable === "user") {
      return soundcloudUserToPlatformChannel(object.data);
    }
  }

  throw new ScriptException("Could not find channel info");
};
source.getChannelContents = function (url) {
  return new ChannelVideoPager({ url: url, page_size: 20, offset_date: 0 });
};

source.getChannelTemplateByClaimMap = () => {
  return {
    //SoundCloud
    17: {
      0: URL_BASE + "/{{CLAIMVALUE}}",
      //Unused! 1: https://api.soundcloud.com/users/{{CLAIMVALUE}}
    },
  };
};

source.isContentDetailsUrl = function (url) {
  // https://soundcloud.com/toosii2x/toosii-favorite-song
  return /soundcloud\.com\/[a-zA-Z0-9-_]+\/[a-zA-Z0-9-_]+/.test(url);
};
source.getContentDetails = function (url) {
  const resp = callUrl(url);

  const html = resp.body;

  const matched = html.match(/window\.__sc_hydration = (.+);/);
  if (!matched) {
    if (IS_TESTING) console.log(html);
    throw new ScriptException("Could not find video info");
  }

  /** @type {SCHydration[]} */
  const json = JSON.parse(matched[1]);

  /** @type {import("./types").SoundcloudTrack} */
  let data;
  /** @type {import("./types").SoundcloudTrack} */
  let sct;

  for (let object of json) {
    if (object.hydratable === "sound") {
      data = object.data;
      sct = soundcloudTrackToPlatformVideo(data);
      break;
    }
  }

  // for performance reasons, select just the mpeg transcoding if it exists; otherwise, select the first transcoding
  if (data.media.transcodings?.length === 0)
    throw new ScriptException("Could not find transcodings");
  const transcoding =
    data.media.transcodings.find(
      (transcoding) => (transcoding.format.mime_type = "audio/mpeg")
    ) ?? data.media.transcodings[0];

  const authorization = data.track_authorization;
  const generated_url =
    transcoding.url +
    `?client_id=${CLIENT_ID}&track_authorization=${authorization}`;

  const hls_resp = callUrl(generated_url);
  const hls_url = JSON.parse(hls_resp.body).url;

  const sources = [
    new HLSSource({
      name: `${transcoding.format.mime_type}`,
      duration: transcoding.duration,
      url: hls_url,
      language: "Unknown",
    }),
  ];

  sct.video = new UnMuxVideoSourceDescriptor([], sources);
  sct.description = data.description;
  sct.rating = new RatingLikes(data.likes_count);

  return new PlatformVideoDetails(sct);
};
source.getComments = function (url) {
  return new ExtendableCommentPager({ url: url, page: 1, page_size: 20 });
};
// not in Soundcloud
source.getSubComments = function (comment) {
  return new CommentPager([], false, {});
};
source.getUserSubscriptions = function () {
  const following_resp = callUrl("https://soundcloud.com/you/following", true);
  const html = following_resp.body;
  if (IS_TESTING) console.log(html);
  const matched = html.match(/window\.__sc_hydration = (.+);/);
  if (!matched) throw new ScriptException("Could not find user info");
  /** @type {SCHydration[]} */
  const following_json = JSON.parse(matched[1]);
  let id;
  for (let object of following_json) {
    if (object.hydratable === "meUser") {
      id = object.data.id;
      break;
    }
  }
  if (!id) throw new ScriptException("Could not find user info");

  const resp = callUrl(
    `${API_URL}users/${id}/followings?client_id=${CLIENT_ID}&limit=12&offset=0&linked_partitioning=1${URL_ADDITIVE}}`,
    true
  );

  const json = JSON.parse(resp.body);

  /** @type {import("./types.d.ts").SoundcloudUser[]} */
  const users = json.collection;

  return users.map((user) => user.permalink_url);
};
source.getUserPlaylists = function () {
  const url = `${API_URL}me/library/all?client_id=${CLIENT_ID}&limit=10&offset=0&linked_partioning=1${URL_ADDITIVE}`;

  const resp = callUrl(url, true);

  if (IS_TESTING) {
    console.log(url);
    console.log(resp.body);
  }
  const json = JSON.parse(resp.body);

  if (IS_TESTING) console.log(json);

  /** @type {import("./types.d.ts").PlaylistWrapper[]} */
  const playlists = json.collection;

  return playlists.map((playlist) => {
    if ("playlist" in playlist) {
      return playlist.playlist.permalink_url;
    } else if ("system_playlist" in playlist) {
      return playlist.system_playlist.permalink_url;
    }
  });
};
source.isPlaylistUrl = function (url) {
  return /soundcloud\.com\/[a-zA-Z0-9-_]+\/sets\/[a-zA-Z0-9-_]+/.test(url);
};
source.getPlaylist = function (url) {
  const resp = callUrl(url, true);

  const html = resp.body;

  const matched = html.match(/window\.__sc_hydration = (.+);/);

  if (!matched) {
    throw new ScriptException("Could not find playlist info");
  }

  /** @type {SCHydration[]} */
  const json = JSON.parse(matched[1]);

  /** @type {number[]} */
  let ids = [];

  for (let object of json) {
    if (object.hydratable === "systemPlaylist") {
      ids = object.data.tracks.map((track) => track.id);
      break;
    } else if (object.hydratable === "playlist") {
      ids = object.data.tracks.map((track) => track.id);
      break;
    }
  }
  /** @type {import("./types.d.ts").SoundcloudTrack[]} */
  let tracks = [];

  // split ids into chunks of 50
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);

    const generated_url = `${API_URL}tracks?ids=${chunk.join(
      ","
    )}&client_id=${CLIENT_ID}${URL_ADDITIVE}`;
    const chunk_resp = callUrl(generated_url, true);
    const found_tracks = JSON.parse(chunk_resp.body);

    tracks = tracks.concat(found_tracks);
  }

  return tracks.map((track) => track.permalink_url);
};

//* Internals
/**
 * Gets the URL with correct headers
 * @param {string} url
 * @param {boolean} is_authenticated
 * @param {boolean} use_mobile
 * @returns {HTTPResponse}
 */
function callUrl(url, is_authenticated = false, use_mobile = false) {
  let headers = {
    "User-Agent": use_mobile ? USER_AGENT_MOBILE : USER_AGENT_DESKTOP,
    DNT: "1",
    Connection: "keep-alive",
    Origin: "https://soundcloud.com",
    Referer: "https://soundcloud.com/",
  };

  let accept =
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

  if (url.includes("api-v2.soundcloud.com")) {
    accept = "application/json, text/javascript, */*; q=0.01";
    headers["Host"] = "api-v2.soundcloud.com";
    headers["SEC-FETCH-DEST"] = "empty";
    headers["SEC-FETCH-MODE"] = "cors";
    headers["SEC-FETCH-SITE"] = "same-site";
  } else {
    headers["SEC-FETCH-DEST"] = "document";
    headers["SEC-FETCH-MODE"] = "navigate";
    headers["SEC-FETCH-SITE"] = "none";
  }

  headers["Accept"] = accept;

  return http.GET(url, headers, is_authenticated);
}

/**
 * Gets the client_id from the Soundcloud home page
 * @returns {string} returns the client_id
 */
function getClientId() {
  // request soundcloud.com to find the url of the js file that contains 50-_____.js
  const resp = callUrl("https://soundcloud.com/discover", false, true);
  const html = resp.body;

  // find "clientId":"iZIs9mchVcX5lhVRyQGGAYlNPVldzAoX"
  const matched = html.match(/"clientId":"([a-zA-Z0-9-_]+)"/);

  if (!matched) {
    throw new ScriptException("Could not find client_id");
  }

  const clientId = matched[1];

  return clientId;
}

/**
 * Gets the Soundcloud homepage content
 * @param {import("./types").HomeContext} context the search context
 * @returns {PlatformVideo[]} returns the homepage content
 */
function getHomepageContent(context) {
  const limit = context.page_size;
  const offset = (context.page - 1) * limit;
  const url = `${API_URL}featured_tracks/top/all-music?client_id=${CLIENT_ID}&limit=${limit}&offset=${offset}&linked_partitioning=1${URL_ADDITIVE}`;

  const resp = callUrl(url);

  /** @type {import("./types").HomepageResponse} */
  const json = JSON.parse(resp.body);

  /** @type {import("./types").SoundcloudTrack[]} */
  const tracks = json["collection"];

  return tracks.map((track) => {
    return soundcloudTrackToPlatformVideo(track);
  });
}

//* Pagers
class QueryPager extends VideoPager {
  /**
   * @param {import("./types.d.ts").HomeContext} context the query params
   */
  constructor(context) {
    const results = getHomepageContent(context);
    super(results, results.length >= context.page_size, context);
  }

  nextPage() {
    this.context.page = this.context.page + 1;
    this.results = getHomepageContent(this.context);
    return this;
  }
}
class SearchPagerVideos extends VideoPager {
  /**
   * @param {import("./types").SearchContext} context the query params
   */
  constructor(context) {
    if (context.get_all) {
      // https://api-v2.soundcloud.com/search?q=search%20and%20destroy%20drake&client_id=VDJ3iu7ZYtUMibDTM2XcUbRijDa3L6ug&limit=20&offset=0&linked_partitioning=1&app_version=1683798046&app_locale=en
      const limit = context.page_size;
      const offset = (context.page - 1) * limit;

      const url = `${API_URL}search?q=${encodeURIComponent(
        context.q
      )}&client_id=${CLIENT_ID}&limit=${limit}&offset=${offset}&linked_partitioning=1${URL_ADDITIVE}`;

      const resp = callUrl(url);

      /** @type {import("./types").AnySearchResponse} */
      const json = JSON.parse(resp.body);

      if (json["collection"] === undefined) {
        if (IS_TESTING) console.log("Soundcloud search response: " + resp.body);
        throw new ScriptException("Could not find collection");
      }

      /** @type {(PlatformVideo | PlatformChannel | PlatformPlaylist)[]} */
      const results = [];

      for (const result of json["collection"]) {
        if (result["kind"] === "track") {
          results.push(soundcloudTrackToPlatformVideo(result));
        } else if (result["kind"] === "user") {
          continue;
          results.push(soundcloudUserToPlatformChannel(result));
        } else if (
          result["kind"] === "playlist" ||
          result["kind"] === "album"
        ) {
          // results.push(soundcloudPlaylistToPlatformPlaylist(result))
        } else {
          if (IS_TESTING)
            console.log("Soundcloud search result: " + JSON.stringify(result));
          throw new ScriptException("Unknown kind: " + result["kind"]);
        }
      }

      super(results, results.length >= context.page_size, context);
    } else {
      const limit = context.page_size;
      const offset = (context.page - 1) * limit;
      const url = `${API_URL}search/tracks?limit=${limit}&offset=${offset}&q=${context.q}&client_id=${CLIENT_ID}${URL_ADDITIVE}`;

      const resp = callUrl(url);

      /** @type {SearchResponse} */
      const json = JSON.parse(resp.body);

      /** @type {SoundcloudTrack[]} */
      const tracks = json["collection"];

      const results = tracks.map((track) =>
        soundcloudTrackToPlatformVideo(track)
      );

      super(results, results.length >= context.page_size, context);
    }
  }

  nextPage() {
    this.context.page = this.context.page + 1;
    return new SearchPagerVideos(this.context);
  }
}
class ChannelVideoPager extends VideoPager {
  /**
   * @param {import("./types.d.ts").ChannelVideoPagerContext} context
   */
  constructor(context) {
    if (!context.id) {
      const resp = callUrl(context.url);
      const matched = resp.body.match(/window\.__sc_hydration = (.+);/);
      if (!matched) {
        throw new ScriptException("Could not find channel info");
      }

      /** @type {import("./types").SCHydration[]} */
      const json = JSON.parse(matched[1]);

      for (let object of json) {
        if (object.hydratable === "user") {
          /** @type {import("./types").SoundcloudUser} */
          const data = object.data;

          context.id = data.id;
          break;
        }
      }
    }

    const url = `${API_URL}users/${context.id}/tracks?representation=&client_id=${CLIENT_ID}&limit=${context.page_size}&offset=${context.offset_date}&linked_partitioning=1${URL_ADDITIVE}`;

    if (IS_TESTING) console.log("Soundcloud channel url: " + url);

    const resp = callUrl(url);
    const parsed = JSON.parse(resp.body);

    /** @type {import("./types").SoundcloudTrack[]} */
    const tracks = parsed["collection"];

    const videos = tracks.map((track) => soundcloudTrackToPlatformVideo(track));

    context["offset_date"] = tracks[tracks.length - 1]?.created_at;

    super(videos, tracks.length > 0, context);
  }

  nextPage() {
    this.context.page = this.context.page + 1;
    return new ChannelVideoPager(this.context);
  }
}
class SearchPagerChannels extends ChannelPager {
  /**
   * @param {import("./types").SearchContext} context the query params
   */
  constructor(context) {
    const limit = context.page_size;
    const offset = (context.page - 1) * limit;
    const url = `${API_URL}search/users?q=${context.q}&client_id=${CLIENT_ID}&limit=${limit}&offset=${offset}&linked_partitioning=1${URL_ADDITIVE}`;

    const resp = callUrl(url);

    /** @type {SearchResponse} */
    const json = JSON.parse(resp.body);

    /** @type {SoundcloudUser[]} */
    const users = json["collection"];

    const results = users.map((user) => soundcloudUserToPlatformChannel(user));

    super(results, results.length >= context.page_size, context);
  }

  nextPage() {
    this.context.page = this.context.page + 1;
    return new SearchPagerChannels(this.context);
  }
}
class ExtendableCommentPager extends CommentPager {
  /**
   * @param {import("./types.d.ts").HomeContext & {url: string; id: number|null}} context
   */
  constructor(context) {
    if (!context.id) {
      const resp = callUrl(context.url);
      const html = resp.body;
      const matched = html.match(/window\.__sc_hydration = (.+);/);
      if (!matched) {
        throw new ScriptException("Could not find comment info");
      }

      /** @type {import("./types").SCHydration[]} */
      const json = JSON.parse(matched[1]);

      for (let object of json) {
        if (object.hydratable === "sound") {
          /** @type {import("./types").SoundcloudTrack} */
          const data = object.data;

          context.id = data.id;
          break;
        }
      }
    }

    // https://api-v2.soundcloud.com/tracks/1506477625/comments?sort=newest&threaded=1&client_id=TihN0nuDfhghD9GVPbTtrSEa558lYo4V&limit=20&offset=0&linked_partitioning=1&app_version=1684153290&app_locale=en
    const limit = context.page_size;
    const offset = (context.page - 1) * limit;

    const url = `${API_URL}tracks/${context.id}/comments?sort=newest&threaded=1&client_id=${CLIENT_ID}&limit=${limit}&offset=${offset}&linked_partitioning=1${URL_ADDITIVE}`;

    const resp = callUrl(url);

    /** @type {import("./types").CommentResponse} */
    const json = JSON.parse(resp.body);

    const comments = json["collection"].map((comment) => {
      return new Comment({
        contextUrl: context.url,
        author: new PlatformAuthorLink(
          new PlatformID(
            PLATFORM,
            comment.user.id.toString(),
            config.id,
            PLATFORM_CLAIMTYPE
          ),
          comment.user.username,
          comment.user.permalink_url,
          comment.user.avatar_url
        ),
        message: comment.body,
        rating: new RatingLikes(0),
        date: parseInt(new Date(comment.created_at).getTime() / 1000),
        replyCount: 0,
        context: null,
      });
    });

    super(comments, json["next_href"] !== null, context);
  }

  nextPage() {
    this.context.page = this.context.page + 1;
    return new ExtendableCommentPager(this.context);
  }
}

//* CONVERTERS
/**
 * Convert a Soundcloud person to a PlatformChannel
 * @param { import("./types").SoundcloudUser } scu
 * @returns { PlatformChannel }
 */
function soundcloudUserToPlatformChannel(scu) {
  return new PlatformChannel({
    id: new PlatformID(
      PLATFORM,
      scu.id.toString(),
      config.id,
      PLATFORM_CLAIMTYPE
    ),
    name: scu.username,
    thumbnail: scu.avatar_url,
    banner:
      scu?.visuals?.visuals.length > 0 ? scu.visuals.visuals[0].visual_url : "",
    subscribers: scu.followers_count,
    description: scu.description,
    url: scu.permalink_url,
    links: scu.visuals ? scu.visuals.visuals.map((v) => v.link) : [],
  });
}

/**
 * Convert a Soundcloud Track to a PlatformVideo
 * @param { import("./types").SoundcloudTrack } sct
 * @returns { PlatformVideo }
 */
function soundcloudTrackToPlatformVideo(sct) {
  return new PlatformVideo({
    id: new PlatformID(PLATFORM, sct.id.toString(), config.id),
    name: sct.title,
    thumbnails: new Thumbnails([
      new Thumbnail(
        sct.artwork_url !== null
          ? sct.artwork_url.replace("large", "t500x500")
          : sct.artwork_url,
        0
      ),
    ]),
    author: new PlatformAuthorLink(
      new PlatformID(
        PLATFORM,
        sct.user_id.toString(),
        config.id,
        PLATFORM_CLAIMTYPE
      ),
      sct.user.username,
      sct.user.permalink_url,
      sct.user.avatar_url
    ),
    uploadDate: parseInt(new Date(sct.created_at).getTime() / 1000),
    duration: parseInt(sct.duration / 1000),
    viewCount: sct.playback_count,
    url: sct.permalink_url,
    isLive: false,
  });
}

console.log("LOADED");
