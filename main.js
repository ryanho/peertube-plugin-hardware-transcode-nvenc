async function register ({
  transcodingManager,
  peertubeHelpers
}) {

  const { logger  } = peertubeHelpers
  const initVaapiOptions = [
    // enable hardware acceleration
    '-hwaccel vaapi',
    '-hwaccel_output_format vaapi',
    '-vaapi_device /dev/dri/renderD128'
  ]
  let latestStreamNum = 9999

  // Add hardware encode through vaapi
  {
    const VODBuilder = (options) => {
      const { input, resolution, fps, streamNum } = options
      const streamSuffix = streamNum == undefined ? '' : `:${streamNum}`
      const targetBitrate = getTargetBitrate(resolution, fps)
      let shouldInitVaapi = (streamNum == undefined || streamNum <= latestStreamNum)

      if (shouldInitVaapi && streamNum != undefined) {
        latestStreamNum = streamNum
      }
      // You can also return a promise
      return {
        scaleFilter: {
          name: 'scale_vaapi'
        },
        inputOptions: shouldInitVaapi ? initVaapiOptions : [],
        outputOptions: [
          '-bf 8', // override hardcoded bf value which cause memory error
          '-pix_fmt vaapi_vld',
          `-preset veryfast`,
          `-b:v${streamSuffix} ${targetBitrate}`,
          `-maxrate ${targetBitrate}`,
          `-bufsize ${targetBitrate * 2}`
        ]
      }
    }

    const liveBuilder = (options) => {
      const { input, resolution, fps, streamNum } = options
      const streamSuffix = streamNum == undefined ? '' : `:${streamNum}`
      const targetBitrate = getTargetBitrate(resolution, fps)
      let shouldInitVaapi = (streamNum == undefined || streamNum <= latestStreamNum)

      if (shouldInitVaapi && streamNum != undefined) {
        latestStreamNum = streamNum
      }

      // You can also return a promise
      return {
        scaleFilter: {
          name: 'scale_vaapi'
        },
        inputOptions: shouldInitVaapi ? initVaapiOptions : [],
        outputOptions: [
          '-bf 8', // override hardcoded bf value which cause memory error
          '-pix_fmt vaapi_vld',
          `-preset veryfast`,
          `-r:v${streamSuffix} ${fps}`,
          `-profile:v${streamSuffix} high`,
          `-level:v${streamSuffix} 3.1`,
          `-g:v${streamSuffix} ${fps*2}`,
          `-b:v${streamSuffix} ${targetBitrate}`,
          `-maxrate ${targetBitrate}`,
          `-bufsize ${targetBitrate * 2}`
        ]
      }
    }

    const encoder = 'h264_vaapi'
    const profileName = 'vaapi'

    // Support this profile for VOD transcoding
    transcodingManager.addVODProfile(encoder, profileName, VODBuilder)
    transcodingManager.addVODEncoderPriority('video', encoder, 1000)

    // And/Or support this profile for live transcoding
    transcodingManager.addLiveProfile(encoder, profileName, liveBuilder)
    transcodingManager.addLiveEncoderPriority('video', encoder, 1000)
  }
}

async function unregister() {
  transcodingManager.removeAllProfilesAndEncoderPriorities()
  return true;
}

module.exports = {
  register,
  unregister
}


// copied from Peertube, is it possible to import it instead of copying it ?
/**
 * Bitrate targets for different resolutions, at VideoTranscodingFPS.AVERAGE.
 *
 * Sources for individual quality levels:
 * Google Live Encoder: https://support.google.com/youtube/answer/2853702?hl=en
 * YouTube Video Info: youtube-dl --list-formats, with sample videos
 */
function getBaseBitrate (resolution) {
  if (resolution === 0) {
    // audio-only
    return 64 * 1000
  }

  if (resolution <= 240) {
    // quality according to Google Live Encoder: 300 - 700 Kbps
    // Quality according to YouTube Video Info: 285 Kbps
    return 320 * 1000
  }

  if (resolution <= 360) {
    // quality according to Google Live Encoder: 400 - 1,000 Kbps
    // Quality according to YouTube Video Info: 700 Kbps
    return 780 * 1000
  }

  if (resolution <= 480) {
    // quality according to Google Live Encoder: 500 - 2,000 Kbps
    // Quality according to YouTube Video Info: 1300 Kbps
    return 1500 * 1000
  }

  if (resolution <= 720) {
    // quality according to Google Live Encoder: 1,500 - 4,000 Kbps
    // Quality according to YouTube Video Info: 2680 Kbps
    return 2800 * 1000
  }

  if (resolution <= 1080) {
    // quality according to Google Live Encoder: 3000 - 6000 Kbps
    // Quality according to YouTube Video Info: 5081 Kbps
    return 5200 * 1000
  }

  if (resolution <= 1440) {
    // quality according to Google Live Encoder: 6000 - 13000 Kbps
    // Quality according to YouTube Video Info: 8600 (av01) - 17000 (vp9.2) Kbps
    return 10_000 * 1000
  }

  // 4K
  // quality according to Google Live Encoder: 13000 - 34000 Kbps
  return 22_000 * 1000
}

/**
 * Calculate the target bitrate based on video resolution and FPS.
 *
 * The calculation is based on two values:
 * Bitrate at VideoTranscodingFPS.AVERAGE is always the same as
 * getBaseBitrate(). Bitrate at VideoTranscodingFPS.MAX is always
 * getBaseBitrate() * 1.4. All other values are calculated linearly
 * between these two points.
 */
function getTargetBitrate (resolution, fps) {
  const baseBitrate = getBaseBitrate(resolution)
  // The maximum bitrate, used when fps === VideoTranscodingFPS.MAX
  // Based on numbers from Youtube, 60 fps bitrate divided by 30 fps bitrate:
  //  720p: 2600 / 1750 = 1.49
  // 1080p: 4400 / 3300 = 1.33
  const maxBitrate = baseBitrate * 1.4
  const maxBitrateDifference = maxBitrate - baseBitrate
  const maxFpsDifference = 60 - 30
  // For 1080p video with default settings, this results in the following formula:
  // 3300 + (x - 30) * (1320/30)
  // Example outputs:
  // 1080p10: 2420 kbps, 1080p30: 3300 kbps, 1080p60: 4620 kbps
  //  720p10: 1283 kbps,  720p30: 1750 kbps,  720p60: 2450 kbps
  return Math.floor(baseBitrate + (fps - 30) * (maxBitrateDifference / maxFpsDifference))
}
