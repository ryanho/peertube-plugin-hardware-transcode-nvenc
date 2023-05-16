import { PluginTranscodingManager } from "@peertube/peertube-types"
import { EncoderOptions, EncoderOptionsBuilderParams, RegisterServerOptions, VideoResolution } from "@peertube/peertube-types"
import { Logger } from 'winston'

let logger : Logger
let transcodingManager : PluginTranscodingManager

const DEFAULT_HARDWARE_DECODE : boolean = false
const DEFAULT_QUALITY : number = -1

let hardwareDecode : boolean = DEFAULT_HARDWARE_DECODE
let quality : number = DEFAULT_QUALITY

let baseBitrates : Map<VideoResolution, number> = new Map([
    [VideoResolution.H_NOVIDEO, 64 * 1000],
    [VideoResolution.H_144P, 320 * 1000],
    [VideoResolution.H_360P, 780 * 1000],
    [VideoResolution.H_480P, 1500 * 1000],
    [VideoResolution.H_720P, 2800 * 1000],
    [VideoResolution.H_1080P, 5200 * 1000],
    [VideoResolution.H_1440P, 10_000 * 1000],
    [VideoResolution.H_4K, 22_000 * 1000]
])

let latestStreamNum = 9999

export async function register(options :RegisterServerOptions) {
    logger = options.peertubeHelpers.logger
    transcodingManager = options.transcodingManager

    logger.info("Registering peertube-plugin-hardware-encode");

    const encoder = 'h264_vaapi'
    const profileName = 'vaapi'

    // Add trasncoding profiles
    transcodingManager.addVODProfile(encoder, profileName, vodBuilder)
    transcodingManager.addVODEncoderPriority('video', encoder, 1000)

    transcodingManager.addLiveProfile(encoder, profileName, liveBuilder)
    transcodingManager.addLiveEncoderPriority('video', encoder, 1000)

    // Get stored data from the database, default to constants if not found
    hardwareDecode = await options.storageManager.getData('hardware-decode') == "true" // ?? DEFAULT_HARDWARE_DECODE // not needed, since undefined == "true" -> false
    quality = parseInt(await options.storageManager.getData('compression-level')) ?? DEFAULT_QUALITY

    for (const [resolution, bitrate] of baseBitrates) {
        const key = `base-bitrate-${resolution}`
        const storedValue = await options.storageManager.getData(key)
        if (storedValue) {
            baseBitrates.set(resolution, parseInt(storedValue) || bitrate)
        }
    }

    logger.info(`Hardware decode: ${hardwareDecode}`)
    logger.info(`Quality: ${quality}`)

    options.registerSetting({
        name: 'hardware-decode',
        label: 'Hardware decode',

        type: 'input-checkbox',

        descriptionHTML: 'Use hardware video decoder instead of software decoder. This will slightly improve performance but may cause some issues with some videos. If you encounter issues, disable this option and restart failed jobs.',

        default: hardwareDecode,
        private: false
    })
    options.registerSetting({
        name: 'quality',
        label: 'Quality',

        type: 'select',
        options: [
            { label: 'Automatic', value: '-1' },
            { label: '1', value: '1' },
            { label: '2', value: '2' },
            { label: '3', value: '3' },
            { label: '4', value: '4' },
            { label: '5', value: '5' },
            { label: '6', value: '6' },
            { label: '7', value: '7' }
        ],

        descriptionHTML: 'This parameter controls the speed / quality tradeoff. Lower values mean better quality but slower encoding. Higher values mean faster encoding but lower quality. This setting is hardware dependent, you may need to experiment to find the best value for your hardware. Some hardware may have less than 7 levels of compression.',

        default: quality.toString(),
        private: false
    })

    options.registerSetting({
        name: 'base-bitrate-description',
        label: 'Base bitrate',

        type: 'html',
        html: '',
        descriptionHTML: `The base bitrate for video in bits. This is the bitrate used when the video is transcoded at 30 FPS. The bitrate will be scaled linearly between this value and the maximum bitrate when the video is transcoded at 60 FPS.`,
           
        private: true,
    })
    for (const [resolution, bitrate] of baseBitrates) {
        options.registerSetting({
            name: `base-bitrate-${resolution}`,
            label: `Base bitrate for ${printResolution(resolution)}`,

            type: 'input',

            default: bitrate.toString(),

            private: false
        })
    }

    options.settingsManager.onSettingsChange(async (settings) => {
        hardwareDecode = settings['hardware-decode'] as boolean
        quality = parseInt(settings['quality'] as string) || DEFAULT_QUALITY

        for (const [resolution, bitrate] of baseBitrates) {
            const key = `base-bitrate-${resolution}`
            const storedValue = settings[key] as string
            if (storedValue) {
                baseBitrates.set(resolution, parseInt(storedValue) || bitrate)
                logger.info(`New base bitrate for ${resolution}: ${baseBitrates.get(resolution)}`)
            }
        }

        logger.info(`New hardware decode: ${hardwareDecode}`)
        logger.info(`New quality: ${quality}`)
    })
}

export async function unregister() {
    logger.info("Unregistering peertube-plugin-hardware-encode")
    transcodingManager.removeAllProfilesAndEncoderPriorities()
    return true
}

function printResolution(resolution : VideoResolution) : string {
    switch (resolution) {
        case VideoResolution.H_NOVIDEO: return 'audio only'
        case VideoResolution.H_144P:
        case VideoResolution.H_360P:
        case VideoResolution.H_480P:
        case VideoResolution.H_720P:
        case VideoResolution.H_1080P:
        case VideoResolution.H_1440P:
            return `${resolution}p`
        case VideoResolution.H_4K: return '4K'

        default: return 'Unknown'
    }
}

function buildInitOptions() {
    if (hardwareDecode) {
        return [
            '-hwaccel vaapi',
            '-vaapi_device /dev/dri/renderD128',
            '-hwaccel_output_format vaapi',
        ]
    } else {
        return [
            '-vaapi_device /dev/dri/renderD128'
        ]
    }
}

async function vodBuilder(params: EncoderOptionsBuilderParams) : Promise<EncoderOptions> {
    const { resolution, fps, streamNum, inputBitrate } = params
    const streamSuffix = streamNum == undefined ? '' : `:${streamNum}`
    let targetBitrate = getTargetBitrate(resolution, fps)
    let shouldInitVaapi = (streamNum == undefined || streamNum <= latestStreamNum)

    if (targetBitrate > inputBitrate) {
        targetBitrate = inputBitrate
    }

    logger.info(`Building encoder options, received ${JSON.stringify(params)}`)
    
    if (shouldInitVaapi && streamNum != undefined) {
        latestStreamNum = streamNum
    }
    // You can also return a promise
    let options : EncoderOptions = {
        scaleFilter: {
            // software decode requires specifying pixel format for hardware filter and upload it to GPU
            name: hardwareDecode ? 'scale_vaapi' : 'format=nv12,hwupload,scale_vaapi'
        },
        inputOptions: shouldInitVaapi ? buildInitOptions() : [],
        outputOptions: [
            `-quality ${quality}`,
            `-b:v${streamSuffix} ${targetBitrate}`,
            `-bufsize ${targetBitrate * 2}`
        ]
    }
    logger.info(`EncoderOptions: ${JSON.stringify(options)}`)
    return options 
}


async function liveBuilder(params: EncoderOptionsBuilderParams) : Promise<EncoderOptions> {
    const { resolution, fps, streamNum, inputBitrate } = params
    const streamSuffix = streamNum == undefined ? '' : `:${streamNum}`
    let targetBitrate = getTargetBitrate(resolution, fps)
    let shouldInitVaapi = (streamNum == undefined || streamNum <= latestStreamNum)

    if (targetBitrate > inputBitrate) {
        targetBitrate = inputBitrate
    }

    logger.info(`Building encoder options, received ${JSON.stringify(params)}`)

    if (shouldInitVaapi && streamNum != undefined) {
      latestStreamNum = streamNum
    }

    // You can also return a promise
    const options = {
      scaleFilter: {
        name: hardwareDecode ? 'scale_vaapi' : 'format=nv12,hwupload,scale_vaapi'
      },
      inputOptions: shouldInitVaapi ? buildInitOptions() : [],
      outputOptions: [
        `-quality ${quality}`,
        `-r:v${streamSuffix} ${fps}`,
        `-profile:v${streamSuffix} high`,
        `-level:v${streamSuffix} 3.1`,
        `-g:v${streamSuffix} ${fps*2}`,
        `-b:v${streamSuffix} ${targetBitrate}`,
        `-bufsize ${targetBitrate * 2}`
      ]
    }
    logger.info(`EncoderOptions: ${JSON.stringify(options)}`)
    return options
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
function getTargetBitrate (resolution : VideoResolution, fps : number) : number {
    const baseBitrate = baseBitrates.get(resolution) || 0
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