async function register ({
  transcodingManager
}) {

  // Adapt bitrate when using libx264 encoder
  {
    const builder = (options) => {
      const { input, resolution, fps, streamNum } = options

      const streamString = streamNum ? ':' + streamNum : ''

      console.log(options);
      // You can also return a promise
      return {
        outputOptions: [
        // enable hardware acceleration
          '-hwaccel vaapi -hwaccel_output_format vaapi -vaapi_device /dev/dri/renderD128'
        ]
      }
    }

    const encoder = 'libx264'
    const profileName = 'foobarbaz'

    // Support this profile for VOD transcoding
    transcodingManager.addVODProfile(encoder, profileName, builder)

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
