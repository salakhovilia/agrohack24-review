import { useEffect, useMemo, useRef, useState } from 'react';
import DatePicker from 'react-datepicker';
import { registerLocale, setDefaultLocale } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import axios from 'axios';

import * as h3 from 'h3-js';
import throttle from 'lodash.throttle';

import { Chart } from 'react-chartjs-2';
import { Chart as ChartJS, registerables } from 'chart.js';

import 'chartjs-adapter-date-fns';
import setDefaultOptions from 'date-fns/setDefaultOptions';

import { ru } from 'date-fns/locale';
import { phenotypes, years } from '../domain/phenotypes';
setDefaultOptions({ locale: ru });
registerLocale('ru', ru);
setDefaultLocale('ru');

ChartJS.register(...registerables);
const Api = axios.create({
  baseURL: import.meta.env.PROD? 'https://somethingintheair.tech/api': 'http://localhost:8010/api',
});

const DefaultAreasConfig = {
  kursk: {
    '8611b36afffffff': true,
    '8611b36d7ffffff': true,
    '8611b36f7ffffff': true,
    '8611b368fffffff': true,
    '8611b369fffffff': true,
    '8611b3687ffffff': true,
    '861195d27ffffff': true,
  },
  voroneszh: {
    '861193ac7ffffff': true,
    '861193acfffffff': true,
    '861193aefffffff': true,
  },
  amur: {
    '8614ae8afffffff': true,
    '8614ae817ffffff': true,
    '8614ae887ffffff': true,
  },
};

const DefaultAreasLabels = {
  kursk: 'Курская об-ть',
  voroneszh: 'Воронежская об-ть',
  amur: 'Приамурье',
};

// selection code
const IDLE = 0;
const SELECTION_TYPE_DIALOG = 1;
const SELECTING_OWN_AREA = 2;

// feature toggle
const USE_FILTERING_BY_SAMPLE_SELECTION = true // если будет не оч хорошо фильтрация работать, можно отключить

export default function Index() {
  const container = useRef(null);
  const map = useRef(null);

  const [date, setDate] = useState(new Date('2024-01-01'));

  const [coords] = useState([52.082869, 35.848206]);
  const [zoom] = useState(10);
  const mapState = useMemo(() => ({ center: coords, zoom }), [coords, zoom]);
  const [isInitialized, setIsInitialized] = useState(false);

  const [territorySelectingMode, setTerritorySelectingMode] = useState(IDLE);
  const [territorySelectedLabel, setTerritorySelectedLabel] = useState(null);
  const territoryCustomSelected = useRef(false)

  const [samplesSelectingMode, setSamplesSelectingMode] = useState(false);
  const [selectedSamples, setSelectedSamples] = useState(() => {
    const item = localStorage.getItem('selectedSamples');
    if (!item) {
      const fullSelectionByDefault = Object.keys(phenotypes).sort();
      localStorage.setItem('selectedSamples', JSON.stringify(fullSelectionByDefault));
      return fullSelectionByDefault
    }
    return JSON.parse(item) || [];
  });

  const isTerritorySelectingMode = () => {
    return territorySelectingMode !== IDLE;
  };

  const [selectedHexagons, setSelectedHexagons] = useState(
    localStorage.getItem('selectedHexagons')
      ? JSON.parse(localStorage.getItem('selectedHexagons'))
      : {},
  );

  const throttledAPICall = throttle(() => {
    fetchData();
  }, 1000);

  const [hexagons, setHexagons] = useState([]);
  // cell hexagon format
  //{
  //  cellId: '',
  //  center: [0, 0],
  //  boundary: [],
  //  weather: { time: [], temperature_2m: [], rain: [], relative_humidity_2m: [] },
  // }
  const [currentHexagon, setCurrentHexagon] = useState(null);

  const [chartData, setChartData] = useState({ labels: [], datasets: [] });

  const [yieldPrediction, setYieldPrediction] = useState([]);

  const fetchData = () => {
    Api.post('/polygons', {
      now: date.getTime(),
      ids: Object.keys(selectedHexagons),
    }).then((response) => {
      setHexagons(response.data);
    });
  };

  const initMap = () => {
    if (map.current || !container.current) return;

    map.current = new ymaps.Map(container.current, mapState);

    map.current.controls.remove('trafficControl');
    map.current.controls.remove('routeEditor');
    map.current.controls.remove('rulerControl');

    map.current.events.add('boundschange', () => {
      setBounds(map.current.getBounds());
    });

    setIsInitialized(true);

    throttledAPICall();
  };

  useEffect(() => {
    ymaps.ready(initMap);
  }, []);

  useEffect(() => {
    throttledAPICall();
  }, [date]);

  useEffect(() => {
    if (isTerritorySelectingMode()) return;

    throttledAPICall();
  }, [territorySelectingMode]);

  useEffect(() => {
    localStorage.setItem('selectedHexagons', JSON.stringify(selectedHexagons));
  }, [selectedHexagons]);

  const [bounds, setBounds] = useState([]);

  const getColor = (hex) => {
    let color = 'rgba(31,169,255,0.5)';

    return color;
  };

  useEffect(() => {
    if (!map.current) return;

    map.current.geoObjects.removeAll();

    const cells = [];
    if (territorySelectingMode === SELECTING_OWN_AREA) {
      const localBounds = map.current.getBounds();

      const viewCoords = [
        localBounds[0],
        [localBounds[0][0], localBounds[1][1]],
        localBounds[1],
        [localBounds[1][0], localBounds[0][1]],
      ];

      cells.push(...h3.polygonToCells(viewCoords, 6, false));
    } else {
      cells.push(...Object.keys(selectedHexagons));
    }

    for (const cell of cells) {
      const boundary = h3.cellToBoundary(cell);

      const hex = hexagons.find((h) => h.cellId === cell);

      let color = getColor(hex);
      if ((currentHexagon && currentHexagon.cellId === cell) || (isTerritorySelectingMode() && selectedHexagons[cell])) {
        color = '#80FF60C7';
      }

      const polygon = new ymaps.Polygon(
        [boundary],
        { id: cell, hintContent: cell },
        {
          hasHint: true,
          openHintOnHover: true,
          openEmptyHint: false,
          fillColor: color,
          strokeColor: 'rgba(31,169,255,0.5)',
        },
      );

      polygon.events.add('click', (e) => {
        const cellId = e.originalEvent.target.properties.get('id');

        if (territorySelectingMode === SELECTING_OWN_AREA) {
          if (cellId in selectedHexagons) {
            delete selectedHexagons[cellId];

            e.originalEvent.target.options.set('fillColor', 'rgba(255,255,255, 0)');
          } else {
            selectedHexagons[cellId] = true;

            e.originalEvent.target.options.set('fillColor', '#80FF60C7');
          }

          setSelectedHexagons({ ...selectedHexagons });
        } else {
          const hex = hexagons.find((h) => h.cellId === cellId);

          setCurrentHexagon(hex);
        }
      });

      map.current.geoObjects.add(polygon);
    }
  }, [map, isInitialized, hexagons, territorySelectingMode, currentHexagon]);

  useEffect(() => {
    if (!currentHexagon?.cellId) return;

    Api.get(`/polygons/${currentHexagon.cellId || ""}`, { params: { now: date.getTime() } }).then(
      (response) => {
        const { weather , yieldPrediction} = response.data;
        const dates = weather.time.map((d) => new Date(d).getTime());

        setYieldPrediction(yieldPrediction);

      setChartData({
        labels: dates,
        datasets: [
          {
            type: 'line',
            label: 'Температура (2 м)',
            borderColor: '#ff6347', // Красная линия для температуры
            backgroundColor: 'rgba(255, 99, 71, 0.2)', // Полупрозрачный фон
            fill: true,
            tension: 0.3, // Сглаживание линии
            pointBackgroundColor: '#ff6347', // Цвет точек
            pointBorderColor: '#fff', // Граница точек
            pointBorderWidth: 2,
            pointStyle: false,
            data: weather.temperature_2m,
            xAxisId: 'x',
            yAxisID: 'y',
          },
          {
            type: 'bar',
            label: 'Осадки',
            borderColor: '#32cd32', // Зеленая линия для осадков
            backgroundColor: 'rgba(50, 205, 50, 0.7)', // Полупрозрачный фон для столбцов
            fill: true,
            tension: 0.3,
            pointBackgroundColor: '#32cd32',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            data: weather.rain,
            borderWidth: 2,
            xAxisId: 'x',
            yAxisID: 'y1',
          },
          {
            type: 'line',
            label: 'Влажность (2 м)',
            borderColor: '#1e90ff', // Синяя линия для влажности
            backgroundColor: 'rgba(30, 144, 255, 0.2)', // Полупрозрачный фон
            fill: true,
            tension: 0.3,
            pointBackgroundColor: '#1e90ff',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointStyle: false,
            data: weather.relative_humidity_2m,
            xAxisId: 'x',
            yAxisID: 'y2',
          },
          {
            type: 'line',
            label: 'Облачность',
            borderColor: '#FFD700',
            backgroundColor: 'rgba(30, 144, 255, 0.2)', // Полупрозрачный фон
            fill: true,
            tension: 0.3,
            pointBackgroundColor: '#FFD700',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointStyle: false,
            data: weather.cloud_cover_high,
            xAxisId: 'x',
            yAxisID: 'y3',
          },
          {
            type: 'line',
            label: 'Влажность почвы (100-255 см)',
            borderColor: '#8A2BE2',
            backgroundColor: 'rgba(30, 144, 255, 0.2)', // Полупрозрачный фон
            fill: true,
            tension: 0.3,
            pointBackgroundColor: '#8A2BE2',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointStyle: false,
            data: weather.soil_moisture_100_to_255cm,
            xAxisId: 'x',
            yAxisID: 'y4',
          },
          {
            type: 'line',
            label: 'Температура почвы (100-255 см)',
            borderColor: '#FF69B4', 
            backgroundColor: 'rgba(30, 144, 255, 0.2)', // Полупрозрачный фон
            fill: true,
            tension: 0.3,
            pointBackgroundColor: '#FF69B4',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointStyle: false,
            data: weather.soil_temperature_100_to_255cm,
            xAxisId: 'x',
            yAxisID: 'y5',
          },
        ],
      });
    },
    );
  }, [currentHexagon, date]);

  const [weatherHint, setWeatherHint] = useState(false)

  return (
      <div className="area container grid h-full min-h-full w-full min-w-full grid-flow-row grid-cols-5 grid-rows-6 gap-2">
        <div className="MAP rounded shadow-lg">
          <div id="map" className="h-full w-full" ref={container} />
        </div>

        <div className="TimeGraphs rounded p-3 shadow-lg">
          <Chart
            type="bar"
            data={chartData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                x: {
                  type: 'time',
                  time: {
                    unit: 'day', // Устанавливает, что будут показываться дни
                    displayFormats: {
                      day: 'dd-MM-yyyy', // Формат для отображения на оси
                    },
                  },
                },
                y: {
                  type: 'linear',
                  display: true,
                  position: 'left',
                },
                y1: {
                  type: 'linear',
                  display: true,
                  position: 'right',
                },
                y2: {
                  type: 'linear',
                  display: false,
                  position: 'right',
                },
                y3: {
                  type: 'linear',
                  display: false,
                  position: 'right',
                },
              },
            }}
          />
        </div>
        <div className="DataBlock1 rounded p-4 shadow-lg">
          <p className="pb-3 text-lg">
            <b>Параметры</b>
          </p>
          <div className="flex flex-row justify-between items-center mb-3">
            <div>
              <p className="text-md">Территория:</p>
            </div>
            <div>
              {territorySelectingMode === SELECTION_TYPE_DIALOG && (
                <TerritorySelectionDialog
                  onSelectionCode={(selectionCode) => {
                    if (!!DefaultAreasConfig[selectionCode]) {
                      territoryCustomSelected.current = false
                      setSelectedHexagons(DefaultAreasConfig[selectionCode]);
                      setCurrentHexagon(null)
                      setTerritorySelectedLabel(DefaultAreasLabels[selectionCode]);
                      setTerritorySelectingMode(IDLE);
                    } else {
                      if (!territoryCustomSelected.current) {
                        setSelectedHexagons({})
                        setCurrentHexagon(null)
                      }
                      territoryCustomSelected.current = true
                      setTerritorySelectingMode(SELECTING_OWN_AREA);
                      setTerritorySelectedLabel(null);
                    }
                  }}
                  closeDialog={() => {
                    setTerritorySelectingMode(IDLE);
                  }}
                />
              )}
              <button
                type="button"
                className={'btn btn-secondary btn-sm text-ellipsis rounded-lg px-2'}
                onClick={() => {
                  var newSelectionMode = territorySelectingMode;
                  if (territorySelectingMode === SELECTING_OWN_AREA) {
                    newSelectionMode = IDLE;
                  } else if (territorySelectingMode === IDLE) {
                    newSelectionMode = SELECTION_TYPE_DIALOG;
                  } else {
                    newSelectionMode = IDLE;
                  }
                  setTerritorySelectingMode(newSelectionMode);
                }}
              >
                {territorySelectingMode === SELECTION_TYPE_DIALOG
                  ? '...'
                  : territorySelectingMode === SELECTING_OWN_AREA
                    ? 'Подтвердить'
                    : territorySelectedLabel
                      ? territorySelectedLabel
                      : 'Выбрать'}
              </button>
            </div>
          </div>
          <div className="flex flex-row justify-between items-center gap-2 py-2 mb-2">
            <div className="">
              <p className="text-md">Год: </p>
            </div>
            <div className="">
              <DatePicker
                className="block w-full text-right"
                selected={date}
                showYearPicker
                dateFormat="yyyy"
                onChange={(date) => setDate(date)}
                customInput={
                  <input
                    type="text"
                    className="input input-bordered input-primary h-8 w-20 rounded"
                  />
                }
              />
            </div>
          </div>
          <div className="flex flex-row justify-between items-center gap-2 py-2">
            <div className="">
              <p className="text-md">Семплы: </p>
            </div>
            {samplesSelectingMode && (
              <SamplesSelectingDialog
                onSelectedSamples={() => {
                  const newSamplesSelection = fetchSelectedSamples();
                  setSelectedSamples(newSamplesSelection);
                  setSamplesSelectingMode(false);
                }}
                closeDialog={() => {
                  setSamplesSelectingMode(false);
                }}
              />
            )}

            <button
              type="button"
              className={'btn btn-secondary btn-sm rounded-lg px-2'}
              onClick={() => {
                setSamplesSelectingMode(true);
              }}
            >
              {!samplesSelectingMode
                ? selectedSamples.length === 0
                  ? 'Выбрать семплы'
                  : `Выбрано ${selectedSamples.length} семплов`
                : '...'}
            </button>
          </div>
          <div className="flex flex-row justify-between items-center gap-2 py-2 relative">
            <div className="mr-4">
              <p className="text-md">Погода: </p>
            </div>
            <div className='flex flex-row items-center justify-end'>
              {weatherHint && <span className='absolute text-xs opacity-70 z-40 top-12 right-0 overflow-visible text-nowrap' >✅ Погода запрашивается автоматически</span>}
              {<img onMouseEnter={() => setWeatherHint(true)} onMouseLeave={() => setWeatherHint(false)} src="/auto.png" alt="Description of the image" className="w-10 h-auto fill-slate-400" />}
            </div>
          </div>
        </div>

        <div className="DataBlock2 p-3 shadow-lg rounded overflow-y-auto">
          <div className="flew-col flex flex-wrap">
            {/* Таблица показателей */}
            <div className="w-full">
              <table className="table">
                {/* head */}
                <thead>
                  <tr>
                    <th>Sample</th>
                    <th>Урожайность</th>
                  </tr>
                </thead>
                <tbody>
                  {yieldPrediction.filter((predict) => 
                    (USE_FILTERING_BY_SAMPLE_SELECTION && !!selectedSamples.find((el) => el === predict.sample)) 
                    || !USE_FILTERING_BY_SAMPLE_SELECTION
                  ).map((predict) =>
                  <tr key={predict.sample}>
                    <td>{predict.sample}</td>
                    <td>
                      {predict.yield.toFixed(2)}
                    </td>
                  </tr>
                  )}
              </tbody>
              </table>
            </div>
        </div>
        </div>
      </div>
  );
}

export function TerritorySelectionDialog({ onSelectionCode, closeDialog }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dialogRef.current && !dialogRef.current.contains(event.target)) {
        closeDialog();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="fixed bottom-0 left-0 right-0 top-0 z-50 flex h-full w-full items-center justify-center bg-black bg-opacity-30">
      <div ref={dialogRef} className="min-w-56 rounded-xl bg-white p-5 opacity-100">
        <p
          className="cursor-pointer p-3 text-start hover:bg-gray-50"
          onClick={() => onSelectionCode(null)}
        >
          Выбрать на карте
        </p>
        <div className="divider">Или</div>
        <p
          className="cursor-pointer p-3 text-start hover:bg-gray-50 rounded"
          onClick={() => onSelectionCode('kursk')}
        >
          Курская область
        </p>
        <p
          className="cursor-pointer p-3 text-start hover:bg-gray-50 rounded"
          onClick={() => onSelectionCode('voroneszh')}
        >
          Воронежская область
        </p>
        <p
          className="cursor-pointer p-3 text-start hover:bg-gray-50 rounded"
          onClick={() => onSelectionCode('amur')}
        >
          Приамурье
        </p>
      </div>
    </div>
  );
}

export function SamplesSelectingDialog({ onSelectedSamples, closeDialog }) {
  const dialogRef = useRef(null);

  const [selectedSamplesList, setSelectedSamplesList] = useState(() => {
    return fetchSelectedSamples();
  });
  const hoverActive = useRef(false);
  const hoverModeAdditive = useRef(false);

  const samplesTable = useMemo(() => {
    return Object.keys(phenotypes)
      .sort()
      .map((sampleName) => {
        return {
          selected: !!selectedSamplesList.find((el) => el === sampleName),
          name: sampleName,
          values: phenotypes[sampleName],
        };
      });
  }, [selectedSamplesList]);
  const [selectAll, setSelectAll] = useState(() => {
    return samplesTable.length === selectedSamplesList.length
  });

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dialogRef.current && !dialogRef.current.contains(event.target)) {
        closeDialog();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const updateItemSelection = (sampleElement) => {
    var updatedSamplesList
    if (!hoverModeAdditive.current) {
       updatedSamplesList = [
        ...selectedSamplesList.filter((sample) => sample !== sampleElement.name),
      ];
    } else {
      updatedSamplesList = [...selectedSamplesList, sampleElement.name]
    }
    setSelectAll(updatedSamplesList.length === samplesTable.length)
    setSelectedSamplesList(updatedSamplesList);
  };

  const helperSelectAll = () => {
    setSelectAll(!selectAll);
    if (selectAll) {
      setSelectedSamplesList([]);
    } else {
      setSelectedSamplesList(samplesTable.map((el) => el.name));
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 top-0 z-50 flex h-full w-full items-center justify-center bg-black bg-opacity-30">
      <div className="h-full w-full p-14">
        <div
          ref={dialogRef}
          className="relative box-border flex h-full max-h-full w-full max-w-full flex-col items-center justify-center rounded-xl bg-white opacity-100"
        >
          <div className="box-border flex w-full max-w-full flex-row justify-between items-center px-8">
            <span className="mt-8 pb-5 text-start font-mono text-xl">Банк семплов</span>
            <div className='flex flex-row justify-center items-center' onClick={() =>
              helperSelectAll()
            }>
              <span className="text-lg px-4">Выбрать все семплы</span>
              <input
                type="checkbox"
                className="checkbox-primary size-5"
                checked={selectAll}
                onChange={() => {
                  helperSelectAll()
                }}
              ></input>
            </div>
          </div>

          <div className="mb-8 box-border flex w-full flex-1 justify-center overflow-auto align-middle">
            <table
              className="box-border w-4/5 table-auto border-collapse items-center justify-center border border-gray-200 text-left align-middle"
              onMouseLeave={() => {
                hoverActive.current = false;
                hoverModeAdditive.current = true
              }}
              onMouseUp={() => {
                hoverActive.current = false;
                hoverModeAdditive.current = true
              }}
            >
              <thead>
                <tr className="hover:bg-gray-100">
                  <th className="border-b border-gray-300 bg-gray-100 px-4 py-2 text-black">Семпл</th>
                  {years.map((el) => (
                    <th key={el} className="border-b border-gray-300 bg-gray-100 py-2 text-sm text-black">
                      {el}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
              {samplesTable.map((el) => (
                <tr key={el.name}
                  className={'select-none hover:bg-gray-100'}
                  onMouseEnter={() => {
                    if (hoverActive.current) {
                      updateItemSelection(el);
                    }
                  }}
                  onMouseDown={() => {
                    hoverModeAdditive.current = !el.selected;
                    hoverActive.current = true;
                    updateItemSelection(el, !el.selected);
                  }}
                >
                  <td className="border-b border-gray-300 px-4 py-2 text-black">
                    <div className="flex flex-row justify-start">
                      <input
                        type="checkbox"
                        className="checkbox-primary"
                        checked={el.selected}
                        readOnly
                      ></input>
                      <span className="px-3 font-mono text-lg">{el.name}</span>
                    </div>
                  </td>
                  {el.values.map((year, index) => (
                    <td key={`${el.name}-${index}`} className="border-b border-gray-300 px-4 py-2 font-mono text-black">
                      {year === '-' ? <span>{year}</span> : <b>{year}</b>}
                    </td>
                  ))}
                </tr>
              ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-row content-end items-end justify-end">
            <button
              type="button"
              className={'btn btn-secondary btn-md mb-8 rounded-lg px-2'}
              onClick={() => {
                localStorage.removeItem('selectedSamples');
                const items = [];
                const set = new Set(selectedSamplesList).values();
                for (const i of set) {
                  items.push(i);
                }
                localStorage.setItem('selectedSamples', JSON.stringify(items));
                onSelectedSamples();
              }}
            >
              Подтвердить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function fetchSelectedSamples() {
  const item = localStorage.getItem('selectedSamples');
  if (!item) return [];
  return JSON.parse(item) || [].length;
}
