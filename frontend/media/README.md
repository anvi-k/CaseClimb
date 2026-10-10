# Private generated demo media

The deployed preview is an original, nonclinical synthetic introduction generated through ElevenLabs Image & Video. It uses the stock Larry / Olive Polo avatar, Michael voice, a worried delivery tag, and this script:

> I am feeling a little overwhelmed. Could you explain what happens next?

Export a reviewed MP4 to `frontend/media/caseclimb-introduction.mp4`. Generated media is ignored by Git; source attachments and provider credentials must never be placed here. The browser offers the preview only when the asset is available and identifies it as prerecorded. It does not represent a live patient response or a reviewed clinical encounter.

Keep this demo under 2 MB for the Lambda/API Gateway response limit. The verified October 10 export is H.264/AAC, 832 × 1088 px, 4.76 seconds, and 669,236 bytes. Generation used Creatify Aurora in the ElevenLabs web app, which displayed 4,242 credits. A fresh source checkout can run without the optional media; reproduce/export it through an entitled account to include the preview in a deployment. Do not rely on temporary provider asset URLs.

## Optional preview poster

The deployed JPEG poster is a frame at 0.4 seconds from the same original stock-avatar introduction. It is ignored with the optional private media bundle. If you have that authorized clip and FFmpeg installed, recreate the poster before building:

```sh
ffmpeg -hide_banner -loglevel error -ss 0.4 -i frontend/media/caseclimb-introduction.mp4 -frames:v 1 -q:v 4 frontend/media/caseclimb-introduction.jpg
```

This is a still preview of the prerecorded introduction. It does not show a live conversation response.
