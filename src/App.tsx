import React, { useState, useMemo } from 'react';
import { Download, Loader2, Youtube, Database, FileSpreadsheet, Upload, ArrowRightLeft, Search } from 'lucide-react';

interface VideoData {
  id: string;
  title: string;
  link: string;
  publishedAt: string;
  viewCount: number;
  duration: string;
  isLive: boolean;
  liveEndTime: string;
}

interface DatabaseExport {
  channelName: string;
  exportDate: string;
  totalViews: number;
  videos: VideoData[];
  fileName?: string;
}

function parseDuration(duration: string) {
  const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
  if (!match) return "00:00";
  const h = parseInt(match[1] || "0");
  const m = parseInt(match[2] || "0");
  const s = parseInt(match[3] || "0");
  let result = "";
  if (h > 0) {
    result += `${h}:`;
    result += `${m.toString().padStart(2, '0')}:`;
  } else {
    result += `${m}:`;
  }
  result += `${s.toString().padStart(2, '0')}`;
  return result;
}

function formatGMT7(dateString: string) {
  if (!dateString || dateString === "n/e" || dateString === "Đang live") return { date: dateString, time: "", full: dateString };
  const d = new Date(dateString);
  const dateStr = d.toLocaleDateString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh' }); // DD/MM/YYYY
  const timeStr = d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }); // HH:MM:SS
  return { date: dateStr, time: timeStr, full: `${timeStr} ${dateStr}` };
}

function generateCSV(data: DatabaseExport) {
  const headers = ["Ngày pub", "Giờ pub", "Link", "Video view", "Tiêu đề", "Độ dài", "Video live"];
  const rows = data.videos.map(v => {
    const pub = formatGMT7(v.publishedAt);
    const liveEnd = (v.isLive && v.liveEndTime !== "Đang live" && v.liveEndTime !== "n/e")
      ? formatGMT7(v.liveEndTime).full
      : v.liveEndTime;
    
    return [
      `"${pub.date}"`,
      `"${pub.time}"`,
      `"${v.link}"`,
      `"${v.viewCount}"`,
      `"${v.title.replace(/"/g, '""')}"`,
      `"${v.duration}"`,
      `"${liveEnd}"`
    ];
  });
  return [headers.map(h => `"${h}"`).join(","), ...rows.map(r => r.join(","))].join("\n");
}

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([type.includes('csv') ? '\uFEFF' + content : content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function getFormattedDatePrefix() {
  const today = new Date();
  const options: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' };
  const parts = new Intl.DateTimeFormat('en-GB', options).formatToParts(today);
  const d = parts.find(p => p.type === 'day')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const y = parts.find(p => p.type === 'year')?.value;
  return `${d}-${m}-${y}`;
}

function getFileDisplayName(file: DatabaseExport) {
  if (file.fileName) {
    return file.fileName.replace(/\.json$/i, '');
  }
  return formatGMT7(file.exportDate).full;
}

function generateCompareCSV(
  compareFiles: DatabaseExport[],
  allVideoIds: string[],
  videoMeta: Record<string, { title: string, link: string, publishedAt: string }>
) {
  // Sort files from newest to oldest for the columns
  const sortedFiles = [...compareFiles].sort((a, b) => {
    const timeDiff = new Date(b.exportDate).getTime() - new Date(a.exportDate).getTime();
    if (timeDiff !== 0) return timeDiff;
    return (b.fileName || "").localeCompare(a.fileName || "");
  });

  // Headers
  const headers = ["Tiêu đề", "Link", "Ngày Pub"];
  sortedFiles.forEach((file) => {
    const dateStr = getFileDisplayName(file);
    headers.push(`View (${dateStr})`);
    headers.push(`Chênh lệch (${dateStr})`);
  });

  // Total Views Row
  const totalRow = ["Tổng View Kênh", "", ""];
  sortedFiles.forEach((file, i) => {
    totalRow.push(file.totalViews.toString());
    if (i < sortedFiles.length - 1) {
      const prevFile = sortedFiles[i + 1]; // The older file
      totalRow.push((file.totalViews - prevFile.totalViews).toString());
    } else {
      totalRow.push("0"); // Oldest file has 0 diff
    }
  });

  // Video Rows
  const rows = allVideoIds.map(vid => {
    const meta = videoMeta[vid];
    const pubDate = formatGMT7(meta.publishedAt).date;
    const row = [`"${meta.title.replace(/"/g, '""')}"`, `"${meta.link}"`, `"${pubDate}"`];

    sortedFiles.forEach((file, i) => {
      const videoInCurrent = file.videos.find(v => v.id === vid);
      const currentView = videoInCurrent ? videoInCurrent.viewCount : 0;
      row.push(currentView.toString());

      if (i < sortedFiles.length - 1) {
        const prevFile = sortedFiles[i + 1]; // The older file
        const videoInPrev = prevFile.videos.find(v => v.id === vid);
        const prevView = videoInPrev ? videoInPrev.viewCount : 0;
        
        const diff = currentView - prevView;
        row.push(diff.toString());
      } else {
        row.push("0"); // Oldest file has 0 diff
      }
    });

    return row;
  });

  const csvContent = [
    headers.map(h => `"${h}"`).join(","),
    totalRow.join(","),
    ...rows.map(r => r.join(","))
  ].join("\n");

  return csvContent;
}

async function fetchChannelData(apiKey: string, channelLink: string, onProgress: (msg: string) => void): Promise<DatabaseExport> {
  let channelId = "";
  let channelTitle = "channel";
  let uploadsPlaylistId = "";
  let totalViews = 0;

  const cleanLink = channelLink.trim();

  const fetchStats = async (id: string) => {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,statistics&id=${id}&key=${apiKey}`);
    const data = await res.json();
    if (data.error) throw new Error(`API Error: ${data.error.message}`);
    if (!data.items || data.items.length === 0) throw new Error("Không tìm thấy chi tiết kênh.");
    return data.items[0];
  };

  if (cleanLink.includes("/channel/")) {
    channelId = cleanLink.split("/channel/")[1].split("/")[0].split("?")[0];
    onProgress("Đang lấy thông tin kênh...");
    const channelData = await fetchStats(channelId);
    channelTitle = channelData.snippet.title;
    uploadsPlaylistId = channelData.contentDetails.relatedPlaylists.uploads;
    totalViews = parseInt(channelData.statistics.viewCount || "0", 10);
  } else if (cleanLink.includes("@")) {
    const handle = cleanLink.split("@")[1].split("/")[0].split("?")[0];
    onProgress("Đang tìm thông tin kênh từ handle...");
    
    let res = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,statistics&forHandle=@${handle}&key=${apiKey}`);
    let data = await res.json();
    
    if (data.error) throw new Error(`API Error: ${data.error.message}`);

    if (!data.items || data.items.length === 0) {
      onProgress("Không tìm thấy bằng handle, đang thử tìm kiếm...");
      res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent('@'+handle)}&key=${apiKey}`);
      data = await res.json();
      if (!data.items || data.items.length === 0) throw new Error("Không tìm thấy kênh với handle này.");
      channelId = data.items[0].snippet.channelId;
      
      const channelData = await fetchStats(channelId);
      channelTitle = channelData.snippet.title;
      uploadsPlaylistId = channelData.contentDetails.relatedPlaylists.uploads;
      totalViews = parseInt(channelData.statistics.viewCount || "0", 10);
    } else {
      channelId = data.items[0].id;
      channelTitle = data.items[0].snippet.title;
      uploadsPlaylistId = data.items[0].contentDetails.relatedPlaylists.uploads;
      totalViews = parseInt(data.items[0].statistics.viewCount || "0", 10);
    }
  } else if (cleanLink.includes("/c/") || cleanLink.includes("/user/")) {
     const parts = cleanLink.split("/");
     const name = parts[parts.length - 1].split("?")[0];
     onProgress("Đang tìm kiếm kênh...");
     const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(name)}&key=${apiKey}`);
     const data = await res.json();
     if (!data.items || data.items.length === 0) throw new Error("Không tìm thấy kênh.");
     channelId = data.items[0].snippet.channelId;
     
     const channelData = await fetchStats(channelId);
     channelTitle = channelData.snippet.title;
     uploadsPlaylistId = channelData.contentDetails.relatedPlaylists.uploads;
     totalViews = parseInt(channelData.statistics.viewCount || "0", 10);
  } else {
    throw new Error("Link kênh không hợp lệ. Vui lòng sử dụng link có chứa /channel/ hoặc @handle");
  }

  if (!uploadsPlaylistId) {
      throw new Error("Kênh này không có video nào.");
  }

  let videoIds: string[] = [];
  let nextPageToken = "";
  
  do {
    onProgress(`Đang lấy danh sách video... (${videoIds.length} videos)`);
    const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=50&pageToken=${nextPageToken}&key=${apiKey}`);
    const data = await res.json();
    if (data.error) throw new Error(`API Error: ${data.error.message}`);
    
    if (data.items) {
      videoIds.push(...data.items.map((item: any) => item.snippet.resourceId.videoId));
    }
    nextPageToken = data.nextPageToken || "";
  } while (nextPageToken);

  const videos: VideoData[] = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    onProgress(`Đang lấy chi tiết video... (${i}/${videoIds.length})`);
    const batch = videoIds.slice(i, i + 50);
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics,liveStreamingDetails&id=${batch.join(",")}&key=${apiKey}`);
    const data = await res.json();
    if (data.error) throw new Error(`API Error: ${data.error.message}`);
    
    if (data.items) {
      videos.push(...data.items.map((item: any) => {
        const isLive = !!item.liveStreamingDetails;
        const actualStartTime = item.liveStreamingDetails?.actualStartTime;
        const actualEndTime = item.liveStreamingDetails?.actualEndTime;
        
        const effectivePublishedAt = actualStartTime || item.snippet.publishedAt;
        const liveEndTimeStr = isLive ? (actualEndTime || "Đang live") : "n/e";

        return {
          id: item.id,
          publishedAt: effectivePublishedAt,
          link: `https://www.youtube.com/watch?v=${item.id}`,
          viewCount: parseInt(item.statistics.viewCount || "0", 10),
          title: item.snippet.title,
          duration: parseDuration(item.contentDetails.duration),
          isLive,
          liveEndTime: liveEndTimeStr
        };
      }));
    }
  }

  onProgress(`Hoàn thành! Đã lấy ${videos.length} video.`);
  return { 
    channelName: channelTitle, 
    exportDate: new Date().toISOString(),
    totalViews,
    videos 
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'scrape' | 'compare'>('scrape');

  // Scrape State
  const [apiKey, setApiKey] = useState('');
  const [channelLinks, setChannelLinks] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [resultsData, setResultsData] = useState<DatabaseExport[]>([]);
  const [error, setError] = useState('');

  // Compare State
  const [compareFiles, setCompareFiles] = useState<DatabaseExport[]>([]);

  const handleFetch = async () => {
    if (!apiKey) {
      setError('Vui lòng nhập YouTube Data API v3 Key');
      return;
    }
    const links = channelLinks.split(/[\n,]+/).map(l => l.trim()).filter(l => l);
    if (links.length === 0) {
      setError('Vui lòng nhập ít nhất một link kênh YouTube');
      return;
    }

    setLoading(true);
    setError('');
    setResultsData([]);

    try {
      const results: DatabaseExport[] = [];
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        setProgress(`Đang xử lý kênh ${i + 1}/${links.length}...`);
        try {
          const data = await fetchChannelData(apiKey, link, (msg) => setProgress(`[Kênh ${i + 1}/${links.length}] ${msg}`));
          results.push(data);
          setResultsData([...results]);
        } catch (err: any) {
          console.error(`Lỗi khi lấy dữ liệu kênh ${link}:`, err);
          alert(`Lỗi khi lấy dữ liệu kênh ${link}: ${err.message}`);
        }
      }
    } finally {
      setLoading(false);
      setProgress('');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    try {
      const parsed = await Promise.all(files.map(async (f: File) => {
        const text = await f.text();
        const data = JSON.parse(text) as DatabaseExport;
        data.fileName = f.name;
        return data;
      }));
      
      // Sort by exportDate ascending (oldest to newest)
      parsed.sort((a, b) => {
        const timeDiff = new Date(a.exportDate).getTime() - new Date(b.exportDate).getTime();
        if (timeDiff !== 0) return timeDiff;
        return (a.fileName || "").localeCompare(b.fileName || "");
      });
      setCompareFiles(parsed);
    } catch (err) {
      alert("Lỗi khi đọc file database. Vui lòng đảm bảo bạn chọn đúng file JSON được xuất từ ứng dụng này.");
    }
  };

  // Memoized comparison data
  const { allVideoIds, videoMeta } = useMemo(() => {
    const ids = new Set<string>();
    const meta: Record<string, { title: string, link: string, publishedAt: string }> = {};
    
    compareFiles.forEach(db => {
      db.videos.forEach(v => {
        ids.add(v.id);
        if (!meta[v.id]) {
          meta[v.id] = { title: v.title, link: v.link, publishedAt: v.publishedAt };
        }
      });
    });

    // Sort videos by publishedAt descending (newest first)
    const sortedIds = Array.from(ids).sort((a, b) => 
      new Date(meta[b].publishedAt).getTime() - new Date(meta[a].publishedAt).getTime()
    );

    return { allVideoIds: sortedIds, videoMeta: meta };
  }, [compareFiles]);

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        
        {/* Header & Tabs */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Youtube className="w-10 h-10 text-red-600" />
            <h1 className="text-3xl font-bold text-gray-900">YouTube Data Tools</h1>
          </div>
          <div className="flex space-x-2 border-b border-gray-200">
            <button
              onClick={() => setActiveTab('scrape')}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'scrape' 
                  ? 'border-red-600 text-red-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4" />
                Lấy Dữ Liệu Kênh
              </div>
            </button>
            <button
              onClick={() => setActiveTab('compare')}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'compare' 
                  ? 'border-red-600 text-red-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4" />
                So Sánh Database
              </div>
            </button>
          </div>
        </div>

        {/* Tab: Scrape */}
        {activeTab === 'scrape' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="p-6 sm:p-8">
                <div className="space-y-5 max-w-2xl">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      YouTube Data API v3 Key
                    </label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="AIzaSy..."
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Link kênh YouTube (mỗi link 1 dòng hoặc cách nhau bằng dấu phẩy)
                    </label>
                    <textarea
                      value={channelLinks}
                      onChange={(e) => setChannelLinks(e.target.value)}
                      placeholder="VD: https://www.youtube.com/@mkbhd&#10;https://www.youtube.com/channel/UC..."
                      rows={4}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-colors resize-y"
                    />
                  </div>

                  {error && (
                    <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm border border-red-100">
                      {error}
                    </div>
                  )}

                  <button
                    onClick={handleFetch}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Đang xử lý...
                      </>
                    ) : (
                      <>
                        <Search className="w-5 h-5" />
                        Lấy thông tin kênh
                      </>
                    )}
                  </button>

                  {progress && (
                    <p className="text-sm text-center text-gray-600 font-medium animate-pulse">
                      {progress}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {resultsData.length > 0 && (
              <div className="space-y-6">
                {resultsData.map((resultData, index) => (
                  <div key={index} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="p-6 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-50/50">
                      <div>
                        <h2 className="text-xl font-bold text-gray-900">{resultData.channelName}</h2>
                        <p className="text-sm text-gray-500 mt-1">
                          Tổng view: <strong className="text-gray-900">{resultData.totalViews.toLocaleString('vi-VN')}</strong> • 
                          Tổng video: <strong className="text-gray-900">{resultData.videos.length}</strong>
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={() => {
                            const csv = generateCSV(resultData);
                            const safeName = resultData.channelName.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'channel';
                            downloadFile(csv, `${getFormattedDatePrefix()}_${safeName}.csv`, 'text/csv;charset=utf-8;');
                          }}
                          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white hover:bg-green-700 rounded-lg text-sm font-medium transition-colors shadow-sm"
                        >
                          <FileSpreadsheet className="w-4 h-4" />
                          Lưu file CSV
                        </button>
                        <button
                          onClick={() => {
                            const json = JSON.stringify(resultData, null, 2);
                            const safeName = resultData.channelName.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'channel';
                            downloadFile(json, `${getFormattedDatePrefix()}_${safeName}.json`, 'application/json');
                          }}
                          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors shadow-sm"
                        >
                          <Database className="w-4 h-4" />
                          Lưu file Database (JSON)
                        </button>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left text-gray-600">
                        <thead className="text-xs text-gray-700 uppercase bg-gray-100/50 border-b border-gray-200">
                          <tr>
                            <th className="px-6 py-4 whitespace-nowrap font-semibold">Ngày pub</th>
                            <th className="px-6 py-4 whitespace-nowrap font-semibold">Giờ pub</th>
                            <th className="px-6 py-4 font-semibold">Tiêu đề</th>
                            <th className="px-6 py-4 whitespace-nowrap font-semibold text-right">Lượt xem</th>
                            <th className="px-6 py-4 whitespace-nowrap font-semibold">Độ dài</th>
                            <th className="px-6 py-4 whitespace-nowrap font-semibold">Video live</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {resultData.videos.slice(0, 10).map((video, idx) => {
                            const pub = formatGMT7(video.publishedAt);
                            const liveEnd = (video.isLive && video.liveEndTime !== "Đang live" && video.liveEndTime !== "n/e")
                              ? formatGMT7(video.liveEndTime).full
                              : video.liveEndTime;

                            return (
                              <tr key={idx} className="bg-white hover:bg-gray-50/80 transition-colors">
                                <td className="px-6 py-4 whitespace-nowrap">{pub.date}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-gray-500">{pub.time}</td>
                                <td className="px-6 py-4 font-medium text-gray-900 max-w-xs truncate" title={video.title}>
                                  <a href={video.link} target="_blank" rel="noreferrer" className="hover:text-blue-600 hover:underline">
                                    {video.title}
                                  </a>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right font-medium">{video.viewCount.toLocaleString('vi-VN')}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-gray-500">{video.duration}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-gray-500">{liveEnd}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {resultData.videos.length > 10 && (
                      <div className="p-4 text-center text-sm text-gray-500 bg-gray-50 border-t border-gray-200">
                        Đang hiển thị 10/{resultData.videos.length} video. Vui lòng lưu file để xem toàn bộ.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab: Compare */}
        {activeTab === 'compare' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 sm:p-8">
              <div className="max-w-2xl">
                <h2 className="text-lg font-bold text-gray-900 mb-2">So sánh các bản ghi Database</h2>
                <p className="text-sm text-gray-500 mb-6">
                  Tải lên nhiều file Database (JSON) của cùng một kênh để xem sự chênh lệch lượt xem qua các ngày.
                </p>
                
                <label className="flex justify-center w-full h-32 px-4 transition bg-white border-2 border-gray-300 border-dashed rounded-xl appearance-none cursor-pointer hover:border-red-400 hover:bg-red-50 focus:outline-none">
                  <span className="flex items-center space-x-2">
                    <Upload className="w-6 h-6 text-gray-600" />
                    <span className="font-medium text-gray-600">
                      Chọn các file JSON database...
                    </span>
                  </span>
                  <input type="file" name="file_upload" className="hidden" multiple accept=".json" onChange={handleFileUpload} />
                </label>
                
                {compareFiles.length > 0 && (
                  <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex flex-wrap gap-2">
                      {compareFiles.map((f, i) => (
                        <span key={i} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                          {f.channelName} ({getFileDisplayName(f)})
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        const csv = generateCompareCSV(compareFiles, allVideoIds, videoMeta);
                        const safeName = compareFiles[0].channelName.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'channel';
                        downloadFile(csv, `sosanh_${getFormattedDatePrefix()}_${safeName}.csv`, 'text/csv;charset=utf-8;');
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white hover:bg-green-700 rounded-lg text-sm font-medium transition-colors shadow-sm"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                      Xuất CSV So Sánh
                    </button>
                  </div>
                )}
              </div>
            </div>

            {compareFiles.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden animate-in fade-in duration-500">
                <div className="p-6 border-b border-gray-200 bg-gray-50/50">
                  <h3 className="text-lg font-bold text-gray-900">
                    Bảng so sánh: {compareFiles[0].channelName}
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left text-gray-600">
                    <thead className="text-xs text-gray-700 uppercase bg-gray-100/50 border-b border-gray-200">
                      <tr>
                        <th className="px-6 py-4 font-semibold min-w-[250px]">Video</th>
                        <th className="px-6 py-4 whitespace-nowrap font-semibold">Ngày Pub</th>
                        {[...compareFiles].sort((a, b) => {
                          const timeDiff = new Date(b.exportDate).getTime() - new Date(a.exportDate).getTime();
                          if (timeDiff !== 0) return timeDiff;
                          return (b.fileName || "").localeCompare(a.fileName || "");
                        }).map((db, i, sortedArr) => (
                          <th key={i} className="px-6 py-4 whitespace-nowrap font-semibold text-right">
                            {getFileDisplayName(db)}
                            <span className="text-gray-400 ml-1">(+/-)</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {/* Total Views Row */}
                      <tr className="bg-red-50/30 hover:bg-red-50/50 transition-colors">
                        <td className="px-6 py-4 font-bold text-gray-900">Tổng View Kênh</td>
                        <td className="px-6 py-4 text-gray-400">-</td>
                        {[...compareFiles].sort((a, b) => {
                          const timeDiff = new Date(b.exportDate).getTime() - new Date(a.exportDate).getTime();
                          if (timeDiff !== 0) return timeDiff;
                          return (b.fileName || "").localeCompare(a.fileName || "");
                        }).map((db, i, sortedArr) => {
                          let diff = 0;
                          if (i < sortedArr.length - 1) {
                            const prevDb = sortedArr[i + 1];
                            diff = db.totalViews - prevDb.totalViews;
                          }
                          return (
                            <td key={i} className="px-6 py-4 whitespace-nowrap text-right">
                              <span className="font-bold text-gray-900">{db.totalViews.toLocaleString('vi-VN')}</span>
                              <span className={`ml-2 text-xs font-bold ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                ({diff > 0 ? '+' : ''}{diff.toLocaleString('vi-VN')})
                              </span>
                            </td>
                          );
                        })}
                      </tr>

                      {/* Video Rows */}
                      {allVideoIds.map(vid => {
                        const meta = videoMeta[vid];
                        return (
                          <tr key={vid} className="bg-white hover:bg-gray-50/80 transition-colors">
                            <td className="px-6 py-4 font-medium text-gray-900 max-w-xs truncate" title={meta.title}>
                              <a href={meta.link} target="_blank" rel="noreferrer" className="hover:text-blue-600 hover:underline">
                                {meta.title}
                              </a>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                              {formatGMT7(meta.publishedAt).date}
                            </td>
                            {[...compareFiles].sort((a, b) => {
                              const timeDiff = new Date(b.exportDate).getTime() - new Date(a.exportDate).getTime();
                              if (timeDiff !== 0) return timeDiff;
                              return (b.fileName || "").localeCompare(a.fileName || "");
                            }).map((db, i, sortedArr) => {
                              const videoInDb = db.videos.find(v => v.id === vid);
                              const currentView = videoInDb ? videoInDb.viewCount : 0;
                              
                              let diff = 0;
                              let isNew = false;
                              if (i < sortedArr.length - 1) {
                                const prevDb = sortedArr[i + 1];
                                const prevVideo = prevDb.videos.find(v => v.id === vid);
                                const prevView = prevVideo ? prevVideo.viewCount : 0;
                                
                                diff = currentView - prevView;
                                if (currentView > 0 && prevView === 0) {
                                  isNew = true;
                                }
                              }

                              return (
                                <td key={i} className="px-6 py-4 whitespace-nowrap text-right">
                                  <span className="font-medium">{currentView.toLocaleString('vi-VN')}</span>
                                  {isNew ? (
                                    <span className="ml-2 text-xs font-medium text-blue-600">(Mới)</span>
                                  ) : (
                                    <span className={`ml-2 text-xs font-medium ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                                      ({diff > 0 ? '+' : ''}{diff.toLocaleString('vi-VN')})
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
