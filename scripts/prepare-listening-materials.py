"""Extract the user-provided lesson media; run only when the source PPTX changes."""
from pathlib import Path
from zipfile import ZipFile
from io import BytesIO
import json, hashlib, xml.etree.ElementTree as ET
from PIL import Image, ImageOps

root = Path(__file__).resolve().parents[1]
source = root.parent / '辨听人体和物体的声音.pptx'
folder = root / 'content' / 'listening'
(folder / 'audio').mkdir(parents=True, exist_ok=True)
(folder / 'images').mkdir(exist_ok=True)
ns = {'a': 'http://schemas.openxmlformats.org/drawingml/2006/main', 'p': 'http://schemas.openxmlformats.org/presentationml/2006/main'}
rn = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
# The audio names and IDs come from each slide's media relationship, not visual order.
specs = [
 ('burp','打嗝','body',1,0,0,'打嗝-1','吃饱后，有时会从嘴里冒出短短的一声。'),
 ('yawn','打哈欠','body',1,0,1,'打哈欠-1','困了的时候，会张大嘴巴长长地呼一口气。'),
 ('sneeze','打喷嚏','body',1,0,2,'打喷嚏声-1','鼻子痒痒时，会突然“阿嚏”一声。'),
 ('snore','打呼噜','body',1,1,0,'鼾声-1','睡着时，有时会发出一阵一阵的呼噜声。'),
 ('cry','哭声','body',1,1,1,'小孩哭-1','难过的时候，会有呜呜的哭声。'),
 ('gargle','漱口','body',1,1,2,'漱口-1','水在嘴里发出咕噜咕噜的声音。'),
 ('nose','擤鼻涕','body',1,2,0,'擤鼻涕-1','用纸巾捂住鼻子，呼气时有呼呼的声音。'),
 ('laugh','笑声','body',1,2,1,'小孩笑-2','开心的时候，会发出哈哈的笑声。'),
 ('cough','咳嗽','body',1,2,2,'咳嗽声-1','喉咙不舒服时，有时会咳咳几声。'),
 ('steps','脚步声','body',4,None,None,'脚步声-1','鞋底一下接一下地碰到地面。'),
 ('whistle','吹口哨','body',5,None,None,'口哨-1','嘴巴吹出的声音细细长长，像在唱歌。'),
 ('applause','拍手','body',6,None,None,'掌声-1','两只手掌碰在一起，发出啪、啪的声音。'),
 ('brush','刷牙','body',7,None,None,'刷牙-1','牙刷来回刷动，会发出沙沙的声音。'),
 ('horn','车喇叭','objects',8,0,0,'车喇叭声-1','汽车用嘀嘀声提醒路上的人。'),
 ('pour','倒水','objects',8,0,1,'倒水','水流进杯子时，会哗啦啦地响。'),
 ('phone','电话铃声','objects',8,0,2,'电话铃声','电话响了，铃声在提醒有人来电话。'),
 ('door','开关门','objects',8,1,0,'开关门声-1','门打开、合上时，会发出吱呀或咔嗒声。'),
 ('siren','警笛声','objects',8,1,1,'警笛声-1','长长的警笛声，一会儿高，一会儿低。'),
 ('doorbell','门铃','objects',8,1,2,'门铃','叮咚，是有人按响了门口的铃。'),
 ('chop','切菜','objects',8,2,0,'切菜','菜刀一下下碰到菜板，声音有节奏。'),
 ('clock','秒表','objects',8,2,1,'秒表滴答-1','滴答、滴答，时间一秒一秒走过去。'),
 ('knock','敲门','objects',8,2,2,'敲门声-1','有人用手叩门，发出笃笃的声音。'),
 ('schoolbell','校园铃声','objects',10,None,None,'校园铃声-1','铃声响起，提醒小朋友上课或下课。'),
 ('hood','油烟机','objects',11,None,None,'油烟机','厨房的油烟机转起来，会持续嗡嗡响。'),
]
sounds=[]
with ZipFile(source) as z:
    audio_by_name={}
    for slide in (1,2):
        rels={r.attrib['Id']:r.attrib['Target'] for r in ET.fromstring(z.read(f'ppt/slides/_rels/slide{slide}.xml.rels'))}
        xml=ET.fromstring(z.read(f'ppt/slides/slide{slide}.xml'))
        for pic in xml.findall('.//p:pic',ns):
            media=pic.find('.//a:audioFile',ns)
            if media is None: continue
            name=pic.find('p:nvPicPr/p:cNvPr',ns).attrib['name']
            audio_by_name[name]=(slide,'ppt/'+rels[media.attrib[rn+'link']].replace('../',''))
    for sid,label,category,image_no,row,col,media_name,clue in specs:
        slide,audio_part=audio_by_name[media_name]
        audio_bytes=z.read(audio_part)
        audio_file=f'audio/{sid}.mp3'
        (folder/audio_file).write_bytes(audio_bytes)
        img=Image.open(BytesIO(z.read(f'ppt/media/image{image_no}.png'))).convert('RGB')
        if row is not None:
            yboxes=([(110,345),(442,678),(763,1000)] if image_no==1 else [(116,333),(428,659),(766,1007)])
            y1,y2=yboxes[row]
            img=img.crop((col*276,y1,(col+1)*276,y2))
        elif image_no in (4,5,6,7):
            img=img.crop((0,0,img.width-5,int(img.height*.78)))
        img=ImageOps.pad(img,(280,260),color='white',method=Image.Resampling.LANCZOS)
        image_file=f'images/{sid}.webp'
        img.save(folder/image_file,'WEBP',quality=88,method=6)
        sounds.append({'id':sid,'label':label,'category':category,'clue':clue,'audio':audio_file,'image':image_file,'source':{'file':source.name,'slide':slide,'media':audio_part,'mediaName':media_name,'sha256':hashlib.sha256(audio_bytes).hexdigest()}})
manifest={'sourceFile':source.name,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'sourceAudioCount':len(audio_by_name),'excluded':[{'name':'枪声-1','reason':'第一版选取身体和日常生活的24种声音。'}],'sounds':sounds}
(folder/'sounds.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'sounds':len(sounds),'audioBytes':sum((folder/s['audio']).stat().st_size for s in sounds),'imageBytes':sum((folder/s['image']).stat().st_size for s in sounds)},ensure_ascii=False))
