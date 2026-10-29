import * as P from './print-layout.js';

export function backTextCanvas(spec,value,maxLong,preview=false){
 const l=P.layout(value,spec);if(!l.ok)throw Error(l.error);
 const dims=maxLong?{width:Math.round(maxLong*spec.widthCm/Math.max(spec.widthCm,spec.heightCm)),height:Math.round(maxLong*spec.heightCm/Math.max(spec.widthCm,spec.heightCm))}:P.exportSize(spec);
 const c=document.createElement('canvas');c.width=dims.width;c.height=dims.height;const x=c.getContext('2d'),k=c.width/spec.widthCm;
 if(preview){x.fillStyle='#d6d9dc';x.fillRect(0,0,c.width,c.height);x.fillStyle='#686e74';for(const m of l.mounts){x.fillRect(m.x*k,m.y*k,m.w*k,m.h*k);x.fillStyle='#202328';if(spec.mount==='float')x.fillRect((m.x+m.w*.4)*k,(m.y+m.h*.15)*k,m.w*.2*k,m.h*.04*k);x.fillStyle='#686e74'}}
 if(l.config){x.fillStyle='#111';x.font=`${l.em*k}px Arial, sans-serif`;x.textBaseline='top';x.textAlign=l.align==='center'?'center':l.align==='right'?'right':'left';const px=l.align==='center'?l.box.x+l.box.w/2:l.align==='right'?l.box.x+l.box.w:l.box.x;l.lines.forEach((line,i)=>x.fillText(line,px*k,(l.box.y+i*l.lineHeight+.15*l.em)*k));}
 return c;
}
