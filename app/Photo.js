"use client";
import { useEffect, useState } from "react";
import { photoGet } from "./lib";

export default function Photo({ id, className = "mini", onClick }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    if (id) photoGet(id).then((d) => alive && setSrc(d || null));
    return () => {
      alive = false;
    };
  }, [id]);
  if (!id || !src) return null;
  return <img className={className} src={src} alt="รูปอาหาร" onClick={onClick} />;
}
