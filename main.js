async function register ({
  transcodingManager
}) {

  // Adapt bitrate when using libx264 encoder
  {
    const builder = (options) => {
      const { input, resolution, fps, streamNum } = options

      // You can also return a promise
      return {
        videoFilters: [
          'hwupload'
        ],
        inputOptions: [
          // enable hardware acceleration
          '-hwaccel vaapi',
          '-hwaccel_output_format vaapi',
          '-vaapi_device /dev/dri/renderD128'
        ],
        outputOptions: [
          '-bf 8', // override hardcoded bf value which cause memory error
          '-pix_fmt vaapi_vld'
        ]
      }
    }

    const encoder = 'h264_vaapi'
    const profileName = 'vaapi'

    // Support this profile for VOD transcoding
    transcodingManager.addVODProfile(encoder, profileName, builder)
    transcodingManager.addVODEncoderPriority('video', encoder, 1000)

    // And/Or support this profile for live transcoding
    transcodingManager.addLiveProfile(encoder, profileName, builder)
  }
}

async function unregister() {
  return true;
}

module.exports = {
  register,
  unregister
}
